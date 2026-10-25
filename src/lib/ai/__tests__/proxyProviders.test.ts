// The local-agent proxy (`providers/agent.ts`) and the hosted service (`providers/hosted.ts`) speak the
// same SSE protocol, so their shared behaviour runs as one suite over both; provider-specific bits follow.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamAgentProxy } from '../providers/agent';
import { streamHosted } from '../providers/hosted';
import { streamAnalysis, DEFAULT_HOSTED_BASE_URL, isHostedAiEnabled } from '../provider';
import { AiError } from '../types';
import type { AiRequest, AiStreamEvent } from '../types';

const req: AiRequest = {
  system: 'sys prompt',
  user: 'user prompt',
  model: 'claude-opus-5',
  maxTokens: 32000,
};

function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}

function delta(text: string): string {
  return `event: delta\ndata: ${JSON.stringify({ text })}\n\n`;
}

function done(stopReason: string, explanation?: string): string {
  return `event: done\ndata: ${JSON.stringify({ stopReason, ...(explanation !== undefined ? { explanation } : {}) })}\n\n`;
}

async function collect(gen: AsyncGenerator<AiStreamEvent>): Promise<AiStreamEvent[]> {
  const out: AiStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

interface ProviderCase {
  name: string;
  /** Start a stream against `baseUrl` with bearer `token`. */
  stream: (baseUrl: string, token: string, request: AiRequest, signal: AbortSignal) => AsyncGenerator<AiStreamEvent>;
  baseUrl: string;
  endpoint: string;
  /** Body fields beyond system/prompt/model/maxTokens. */
  extraBody: Record<string, unknown>;
}

const PROVIDERS: ProviderCase[] = [
  {
    name: 'streamAgentProxy',
    stream: (baseUrl, token, request, signal) => streamAgentProxy({ baseUrl, token }, request, signal),
    baseUrl: 'http://127.0.0.1:8521',
    endpoint: '/api/ai/analyze',
    extraBody: {},
  },
  {
    name: 'streamHosted',
    stream: (baseUrl, token, request, signal) => streamHosted({ baseUrl, accountToken: token }, request, signal),
    baseUrl: 'https://api.oraplanviz.com',
    endpoint: '/v1/analyze',
    extraBody: { kind: 'analyze' },
  },
];

describe.each(PROVIDERS)('$name (shared SSE proxy protocol)', ({ stream, baseUrl, endpoint, extraBody }) => {
  const run = (signal = new AbortController().signal) => stream(baseUrl, 'tok-123', req, signal);
  const firstError = async (gen: AsyncGenerator<AiStreamEvent>) =>
    (await gen.next().catch((e: unknown) => e)) as AiError;

  it('yields text deltas and done, with correct URL/headers/body', async () => {
    fetchMock.mockResolvedValue(sseResponse([delta('Hello'), delta(' world'), done('end_turn')]));

    const events = await collect(run());

    expect(events).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done', stopReason: 'end_turn' },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${baseUrl}${endpoint}`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-123');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      system: 'sys prompt',
      prompt: 'user prompt',
      model: 'claude-opus-5',
      maxTokens: 32000,
      ...extraBody,
    });
  });

  it('strips a trailing slash from the base URL and nulls empty model/maxTokens', async () => {
    fetchMock.mockResolvedValue(sseResponse([done('end_turn')]));

    await collect(stream(`${baseUrl}/`, 't', { ...req, model: '', maxTokens: 0 }, new AbortController().signal));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${baseUrl}${endpoint}`);
    const body = JSON.parse(init.body);
    expect(body.model).toBeNull();
    expect(body.maxTokens).toBeNull();
  });

  it('passes through known stop reasons and the refusal explanation', async () => {
    fetchMock.mockResolvedValue(sseResponse([delta('partial'), done('refusal', 'cannot comply')]));

    expect(await collect(run())).toEqual([
      { type: 'text', text: 'partial' },
      { type: 'done', stopReason: 'refusal', refusalExplanation: 'cannot comply' },
    ]);
  });

  it("maps an unknown stopReason to 'other'", async () => {
    fetchMock.mockResolvedValue(sseResponse([done('something_new')]));

    expect(await collect(run())).toEqual([{ type: 'done', stopReason: 'other' }]);
  });

  it('yields done end_turn when the stream ends without a done event', async () => {
    fetchMock.mockResolvedValue(sseResponse([delta('x')]));

    expect(await collect(run())).toEqual([
      { type: 'text', text: 'x' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('throws AiError from an in-stream error event, mapping status to kind', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        delta('x'),
        `event: error\ndata: ${JSON.stringify({ message: 'rate limited upstream', status: 429 })}\n\n`,
      ]),
    );

    const gen = run();
    expect((await gen.next()).value).toEqual({ type: 'text', text: 'x' });
    const err = await firstError(gen);
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('rate-limit');
    expect(err.status).toBe(429);
    expect(err.message).toBe('rate limited upstream');
  });

  it('maps an in-stream error event without status to kind unknown', async () => {
    fetchMock.mockResolvedValue(sseResponse([`event: error\ndata: ${JSON.stringify({ message: 'boom' })}\n\n`]));

    const err = await firstError(run());
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('unknown');
    expect(err.status).toBeNull();
    expect(err.message).toBe('boom');
  });

  it('maps a pre-stream 401 JSON error to AiError kind auth with the server message', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'invalid token' }), { status: 401 }));

    const err = await firstError(run());
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('auth');
    expect(err.status).toBe(401);
    expect(err.message).toBe('invalid token');
  });

  it('maps a pre-stream 500 error to AiError kind unknown', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'upstream exploded' }), { status: 500 }));

    const err = await firstError(run());
    expect(err.kind).toBe('unknown');
    expect(err.status).toBe(500);
    expect(err.message).toBe('upstream exploded');
  });

  it('falls back to a status message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 400 }));

    const err = await firstError(run());
    expect(err.kind).toBe('bad-request');
    expect(err.status).toBe(400);
    expect(err.message).toContain('400');
  });

  it('maps abort to AiError kind aborted', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));

    const controller = new AbortController();
    controller.abort();
    const err = await firstError(run(controller.signal));
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('aborted');
  });

  it('maps fetch TypeError to AiError kind network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    expect((await firstError(run())).kind).toBe('network');
  });
});

describe('streamHosted', () => {
  it('maps a pre-stream 402 to AiError kind auth with a subscription message', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'payment required' }), { status: 402 }));

    const gen = streamHosted({ baseUrl: 'https://api.oraplanviz.com', accountToken: 'acct-123' }, req, new AbortController().signal);
    const err = (await gen.next().catch((e: unknown) => e)) as AiError;
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('auth');
    expect(err.status).toBe(402);
    expect(err.message).toContain('payment required');
    expect(err.message).toContain('subscription');
  });
});

describe('streamAnalysis hosted dispatch', () => {
  it('routes hosted requests to the default base URL with the account token', async () => {
    fetchMock.mockResolvedValue(sseResponse([done('end_turn')]));

    await collect(
      streamAnalysis(
        { provider: 'hosted', model: '', accountToken: 'acct-xyz' },
        req,
        new AbortController().signal,
      ),
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${DEFAULT_HOSTED_BASE_URL}/v1/analyze`);
    expect(init.headers.Authorization).toBe('Bearer acct-xyz');
  });

  it('respects an explicit hostedBaseUrl', async () => {
    fetchMock.mockResolvedValue(sseResponse([done('end_turn')]));

    await collect(
      streamAnalysis(
        { provider: 'hosted', model: '', accountToken: 't', hostedBaseUrl: 'https://staging.example.com' },
        req,
        new AbortController().signal,
      ),
    );

    expect(fetchMock.mock.calls[0][0]).toBe('https://staging.example.com/v1/analyze');
  });

  it('throws bad-request when the account token is missing', () => {
    expect(() =>
      streamAnalysis({ provider: 'hosted', model: '' }, req, new AbortController().signal),
    ).toThrowError(AiError);
  });
});

describe('isHostedAiEnabled', () => {
  it('is off by default', () => {
    vi.stubEnv('VITE_ENABLE_HOSTED', '');
    expect(isHostedAiEnabled()).toBe(false);
  });
  it.each(['1', 'true'])('is on for VITE_ENABLE_HOSTED=%s', (v) => {
    vi.stubEnv('VITE_ENABLE_HOSTED', v);
    expect(isHostedAiEnabled()).toBe(true);
  });
  it('ignores other values', () => {
    vi.stubEnv('VITE_ENABLE_HOSTED', 'yes');
    expect(isHostedAiEnabled()).toBe(false);
  });
});
