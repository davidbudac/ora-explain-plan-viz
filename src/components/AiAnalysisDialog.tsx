import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { useAi } from '../hooks/useAiAnalysis';
import { runAdvisor } from '../lib/advisor';
import { isDbAgentEnabled, normalizeBaseUrl, DEFAULT_AGENT_BASE_URL } from '../lib/agent/client';
import { loadSettings, saveSettings } from '../lib/settings';
import { assembleContext, buildAnalyzeSections, buildCompareSections, buildTestCaseSections } from '../lib/ai/context';
import { MODEL_PRESETS } from '../lib/ai/prompts';
import { getAiSecret, setAiSecret } from '../lib/ai/secrets';
import type { AiRunConfig } from '../lib/ai/provider';
import { DEFAULT_HOSTED_BASE_URL, isHostedAiEnabled } from '../lib/ai/provider';
import type { AiProviderId, AiSectionId } from '../lib/ai/types';

interface AiAnalysisDialogProps {
  onClose: () => void;
}

/** Warn when the assembled context exceeds this many estimated tokens. */
const TOKEN_WARNING_THRESHOLD = 150_000;

const CUSTOM_MODEL = '__custom__';

const AGENT_URL_STORAGE_KEY = 'oraplanviz.agentUrl';
const AGENT_TOKEN_STORAGE_KEY = 'oraplanviz.agentToken';

function loadAgentBaseUrl(): string {
  try {
    return localStorage.getItem(AGENT_URL_STORAGE_KEY) || DEFAULT_AGENT_BASE_URL;
  } catch {
    return DEFAULT_AGENT_BASE_URL;
  }
}

function loadAgentToken(): string {
  try {
    return sessionStorage.getItem(AGENT_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

const PROVIDER_OPTIONS: { value: AiProviderId; label: string; description: string; gate?: 'hosted' | 'agent' }[] = [
  {
    value: 'hosted',
    label: 'oraplanviz cloud (hosted)',
    description: 'The hosted service holds the model credentials; you authenticate with an account token.',
    gate: 'hosted',
  },
  {
    value: 'anthropic',
    label: 'Anthropic (bring your own API key)',
    description: 'Streams directly from your browser to api.anthropic.com using your key.',
  },
  {
    value: 'openai-compat',
    label: 'OpenAI-compatible endpoint',
    description: 'Any /chat/completions server — Ollama, OpenRouter, or a gateway you run.',
  },
  {
    value: 'agent',
    label: 'Local oraplanviz-agent',
    description: 'The companion agent on this machine holds the credentials and proxies the request.',
    gate: 'agent',
  },
];

export function AiAnalysisDialog({ onClose }: AiAnalysisDialogProps) {
  const { plans, activePlanIndex, comparePlanIndices, metadataBundle } = usePlan();
  const { aiDialogMode, runAnalysis, status } = useAi();

  // Snapshot settings once on mount (state, not a ref — reading a ref during
  // render trips react-hooks/refs).
  const [settings] = useState(loadSettings);

  const agentAvailable = isDbAgentEnabled();
  const hostedAvailable = isHostedAiEnabled();
  const providerAvailable = (id: AiProviderId) =>
    id === 'agent' ? agentAvailable : id === 'hosted' ? hostedAvailable : true;
  const [provider, setProvider] = useState<AiProviderId>(() =>
    providerAvailable(settings.aiProvider) ? settings.aiProvider : 'anthropic',
  );

  // Anthropic model: preset select + free-text override.
  const initialModel = settings.aiAnthropicModel;
  const initialIsPreset = MODEL_PRESETS.some((p) => p.id === initialModel);
  const [modelChoice, setModelChoice] = useState(initialIsPreset ? initialModel : CUSTOM_MODEL);
  const [customModel, setCustomModel] = useState(initialIsPreset ? '' : initialModel);

  const [anthropicKey, setAnthropicKey] = useState(() => getAiSecret('anthropic') ?? '');
  const [openAiKey, setOpenAiKey] = useState(() => getAiSecret('openai') ?? '');
  const [hostedToken, setHostedToken] = useState(() => getAiSecret('hosted') ?? '');
  const [rememberKey, setRememberKey] = useState(false);

  const [openAiBaseUrl, setOpenAiBaseUrl] = useState(settings.aiOpenAiBaseUrl);
  const [openAiModel, setOpenAiModel] = useState(settings.aiOpenAiModel);

  const [agentBaseUrl] = useState(loadAgentBaseUrl);
  const [agentToken] = useState(loadAgentToken);

  const [previewOpen, setPreviewOpen] = useState(false);

  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Source plans for the current mode.
  const mode = aiDialogMode;
  const activeSlot = plans[activePlanIndex];
  const [compareLeft, compareRight] = comparePlanIndices;
  const planA = plans[compareLeft]?.parsedPlan ?? null;
  const planB = plans[compareRight]?.parsedPlan ?? null;
  const analyzePlan = activeSlot?.parsedPlan ?? null;

  // Test-case builds require an attached metadata bundle (DDL + stats).
  const missingBundle = mode === 'testcase' && !metadataBundle;

  const sectioned = useMemo(() => {
    if (mode === 'compare') {
      if (!planA || !planB) return null;
      return buildCompareSections(planA, planB);
    }
    if (!analyzePlan) return null;
    const advisorReport = runAdvisor(analyzePlan, metadataBundle ?? null);
    if (mode === 'testcase') {
      if (!metadataBundle) return null;
      return buildTestCaseSections(analyzePlan, metadataBundle, advisorReport);
    }
    return buildAnalyzeSections(analyzePlan, metadataBundle ?? null, advisorReport);
  }, [mode, analyzePlan, planA, planB, metadataBundle]);

  // Per-section include toggles, seeded from persisted settings.
  const [included, setIncluded] = useState<Partial<Record<AiSectionId, boolean>>>(() => ({
    ...settings.aiSections,
  }));

  const builtContext = useMemo(() => {
    if (!sectioned) return null;
    const sections = sectioned.sections.map((s) => ({
      ...s,
      included: included[s.id] ?? true,
    }));
    return assembleContext(sectioned.core, sections);
  }, [sectioned, included]);

  const model = provider === 'hosted'
    ? ''
    : provider === 'openai-compat'
      ? openAiModel.trim()
      : modelChoice === CUSTOM_MODEL
        ? customModel.trim()
        : modelChoice;

  const targetHost = provider === 'hosted'
    ? hostOf(DEFAULT_HOSTED_BASE_URL)
    : provider === 'anthropic'
      ? 'api.anthropic.com'
      : provider === 'openai-compat'
        ? openAiBaseUrl.trim()
          ? hostOf(openAiBaseUrl.trim())
          : 'the endpoint you enter above'
        : `the local agent at ${hostOf(agentBaseUrl)}`;

  const configValid =
    builtContext !== null &&
    status !== 'streaming' &&
    (provider === 'hosted'
      ? hostedToken.trim() !== ''
      : provider === 'anthropic'
        ? anthropicKey.trim() !== '' && model !== ''
        : provider === 'openai-compat'
          ? openAiBaseUrl.trim() !== '' && model !== ''
          : agentToken.trim() !== '');

  const run = async () => {
    if (!builtContext || !configValid) return;

    // Persist non-secret preferences; keys go to sessionStorage (opt-in localStorage).
    saveSettings({
      aiProvider: provider,
      ...(provider === 'anthropic' && model !== '' ? { aiAnthropicModel: model } : {}),
      ...(provider === 'openai-compat'
        ? { aiOpenAiBaseUrl: openAiBaseUrl.trim(), aiOpenAiModel: openAiModel.trim() }
        : {}),
      aiSections: {
        ...settings.aiSections,
        ...Object.fromEntries(
          (sectioned?.sections ?? []).map((s) => [s.id, included[s.id] ?? true]),
        ),
      },
    });
    if (provider === 'anthropic' && anthropicKey.trim() !== '') {
      setAiSecret('anthropic', anthropicKey.trim(), rememberKey);
    }
    if (provider === 'openai-compat' && openAiKey.trim() !== '') {
      setAiSecret('openai', openAiKey.trim(), rememberKey);
    }
    if (provider === 'hosted' && hostedToken.trim() !== '') {
      setAiSecret('hosted', hostedToken.trim(), rememberKey);
    }

    const runConfig: AiRunConfig = provider === 'hosted'
      ? { provider, model, accountToken: hostedToken.trim(), hostedBaseUrl: DEFAULT_HOSTED_BASE_URL }
      : provider === 'anthropic'
        ? { provider, apiKey: anthropicKey.trim(), model }
        : provider === 'openai-compat'
          ? { provider, apiKey: openAiKey.trim(), baseUrl: openAiBaseUrl.trim(), model }
          : {
              provider,
              model,
              agent: { baseUrl: normalizeBaseUrl(agentBaseUrl), token: agentToken.trim() },
            };

    const slotIds = mode === 'compare' ? [compareLeft, compareRight] : [activePlanIndex];
    void runAnalysis(runConfig, builtContext, mode, slotIds);
    onClose();
  };

  const inputClass =
    'w-full px-2.5 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 border border-neutral-200 dark:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500/60';
  const labelClass =
    'block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1 uppercase tracking-wide';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 dark:bg-black/60 overflow-y-auto p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-neutral-900 rounded-lg shadow-xl border border-neutral-200 dark:border-neutral-700 w-[680px] max-w-[95vw] my-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {mode === 'compare' ? 'AI Compare Plans' : mode === 'testcase' ? 'AI Build Test Case' : 'AI Analyze Plan'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200 text-lg leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-4">
          {!sectioned && !missingBundle && (
            <p className="text-[11px] text-red-600 dark:text-red-400">
              {mode === 'compare'
                ? 'Both compare plans must be loaded and parsed before running an AI comparison.'
                : 'Load and parse a plan before running an AI analysis.'}
            </p>
          )}

          {missingBundle && analyzePlan && (
            <div className="rounded-md border border-amber-500/20 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300 leading-snug">
              <p className="font-semibold mb-1">Schema metadata bundle required</p>
              <p>
                Building a test case needs the referenced objects&apos; DDL and optimizer statistics.
                Generate a gather script from the input panel (Metadata → Gather script), run it in
                the source database, and attach the resulting JSON bundle to this plan — then reopen
                this dialog.
              </p>
            </div>
          )}

          {/* Provider */}
          <div>
            <span className={labelClass}>Provider</span>
            <div className="flex flex-col gap-1.5">
              {PROVIDER_OPTIONS.filter((opt) => !opt.gate || providerAvailable(opt.value)).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-2 p-2 rounded-md border cursor-pointer transition-colors ${
                    provider === opt.value
                      ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20'
                      : 'border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                  }`}
                >
                  <input
                    type="radio"
                    name="ai-provider"
                    value={opt.value}
                    checked={provider === opt.value}
                    onChange={() => setProvider(opt.value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                      {opt.label}
                    </span>
                    <span className="block text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">
                      {opt.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Provider-specific configuration */}
          {provider === 'hosted' && (
            <div>
              <label className={labelClass}>Account token</label>
              <input
                type="password"
                value={hostedToken}
                onChange={(e) => setHostedToken(e.target.value)}
                placeholder="Your oraplanviz cloud account token"
                spellCheck={false}
                autoComplete="off"
                className={inputClass}
              />
              <label className="mt-1.5 flex items-center gap-1.5 cursor-pointer text-[11px] text-neutral-600 dark:text-neutral-400">
                <input
                  type="checkbox"
                  checked={rememberKey}
                  onChange={(e) => setRememberKey(e.target.checked)}
                />
                Remember on this device
              </label>
              <p className="mt-1.5 text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">
                The model is pinned server-side — no model selection is needed.
              </p>
            </div>
          )}

          {provider === 'anthropic' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Model</label>
                <select
                  value={modelChoice}
                  onChange={(e) => setModelChoice(e.target.value)}
                  className={inputClass}
                >
                  {MODEL_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                  <option value={CUSTOM_MODEL}>Custom model id…</option>
                </select>
                {modelChoice === CUSTOM_MODEL && (
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value.trim())}
                    placeholder="e.g. claude-opus-5"
                    spellCheck={false}
                    className={`${inputClass} mt-1.5`}
                  />
                )}
              </div>
              <div>
                <label className={labelClass}>API key</label>
                <input
                  ref={firstFieldRef}
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-…"
                  spellCheck={false}
                  autoComplete="off"
                  className={inputClass}
                />
                <label className="mt-1.5 flex items-center gap-1.5 cursor-pointer text-[11px] text-neutral-600 dark:text-neutral-400">
                  <input
                    type="checkbox"
                    checked={rememberKey}
                    onChange={(e) => setRememberKey(e.target.checked)}
                  />
                  Remember on this device
                </label>
              </div>
            </div>
          )}

          {provider === 'openai-compat' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Base URL</label>
                <input
                  type="text"
                  value={openAiBaseUrl}
                  onChange={(e) => setOpenAiBaseUrl(e.target.value)}
                  placeholder="e.g. http://localhost:11434"
                  spellCheck={false}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Model</label>
                <input
                  type="text"
                  value={openAiModel}
                  onChange={(e) => setOpenAiModel(e.target.value)}
                  placeholder="e.g. qwen2.5:32b"
                  spellCheck={false}
                  className={inputClass}
                />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>API key (optional)</label>
                <input
                  type="password"
                  value={openAiKey}
                  onChange={(e) => setOpenAiKey(e.target.value)}
                  placeholder="Leave empty for local servers"
                  spellCheck={false}
                  autoComplete="off"
                  className={inputClass}
                />
                <label className="mt-1.5 flex items-center gap-1.5 cursor-pointer text-[11px] text-neutral-600 dark:text-neutral-400">
                  <input
                    type="checkbox"
                    checked={rememberKey}
                    onChange={(e) => setRememberKey(e.target.checked)}
                  />
                  Remember on this device
                </label>
              </div>
            </div>
          )}

          {provider === 'agent' && (
            <div className="text-[11px] text-neutral-600 dark:text-neutral-400 leading-snug">
              Uses the agent connection from the Connect panel (
              <code className="font-mono">{agentBaseUrl}</code>). The agent holds the AI
              credentials; no key is entered here.
              {agentToken.trim() === '' && (
                <p className="mt-1 text-red-600 dark:text-red-400">
                  No agent token found — connect to the agent in the Connect panel first.
                </p>
              )}
            </div>
          )}

          {/* Section checklist */}
          {sectioned && builtContext && (
            <div>
              <span className={labelClass}>Data to send</span>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-1.5 leading-snug">
                The plan table{mode === 'compare' ? 's and node match digest are' : ' is'} always
                included ({sectioned.core.length.toLocaleString()} chars). Toggle the optional
                sections below.
              </p>
              <div className="flex flex-col gap-1">
                {sectioned.sections.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <input
                      type="checkbox"
                      checked={included[s.id] ?? true}
                      onChange={(e) =>
                        setIncluded((prev) => ({ ...prev, [s.id]: e.target.checked }))
                      }
                    />
                    <span className="text-xs text-neutral-800 dark:text-neutral-200 flex-1">
                      {s.label}
                    </span>
                    <span className="text-[10px] font-mono text-neutral-400 dark:text-neutral-500">
                      {s.charCount.toLocaleString()} chars
                    </span>
                  </label>
                ))}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] text-neutral-600 dark:text-neutral-400">
                  Estimated size:{' '}
                  <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                    ~{builtContext.tokenEstimate.toLocaleString()} tokens
                  </span>
                </span>
                {builtContext.tokenEstimate > TOKEN_WARNING_THRESHOLD && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                    Large context — consider unchecking sections
                  </span>
                )}
              </div>

              <details
                className="mt-2"
                open={previewOpen}
                onToggle={(e) => setPreviewOpen((e.target as HTMLDetailsElement).open)}
              >
                <summary className="text-[10px] text-neutral-500 dark:text-neutral-400 cursor-pointer select-none hover:text-neutral-700 dark:hover:text-neutral-300">
                  Preview exactly what will be sent (
                  {builtContext.userMessage.length.toLocaleString()} chars)
                </summary>
                <pre className="mt-1 text-[10px] font-mono p-2 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 text-neutral-800 dark:text-neutral-200 whitespace-pre overflow-auto max-h-72">
                  {builtContext.userMessage}
                </pre>
              </details>
            </div>
          )}

          {/* Privacy notice */}
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug border-t border-neutral-100 dark:border-neutral-800 pt-3">
            Nothing leaves your browser until you click Run. When you do, the data previewed above
            (plan, and any checked sections) is sent to{' '}
            <span className="font-semibold text-neutral-700 dark:text-neutral-300">{targetHost}</span>
            . Your API key is never stored in shared URLs or exported files.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          {!missingBundle && (
            <button
              type="button"
              onClick={run}
              disabled={!configValid}
              className="text-xs px-4 py-1.5 font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {status === 'streaming' ? 'Running…' : mode === 'testcase' ? 'Build test case' : 'Run analysis'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
