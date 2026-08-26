/**
 * AI streaming via the local oraplanviz-agent companion proxy.
 *
 * The agent holds the model credentials (e.g. a Claude subscription profile)
 * on the user's own machine; the browser only ever talks to localhost. Wire
 * contract (see docs/plans/ai-plan-analysis.md):
 *
 *   POST {baseUrl}/api/ai/analyze   Authorization: Bearer <token>
 *   Body: { system, prompt, model|null, maxTokens|null }
 *   → 200 text/event-stream:
 *       event delta {"text"} · event done {"stopReason","explanation"?}
 *       · event error {"message","status"?}
 *   → 401/500 JSON {"error"} before streaming
 */

import type { AgentConfig } from '../../agent/client';
import { normalizeBaseUrl } from '../../agent/client';
import type { AiRequest, AiStopReason, AiStreamEvent } from '../types';
import { AiError } from '../types';
import { parseSseStream } from './sse';

const STOP_REASONS: readonly AiStopReason[] = ['end_turn', 'max_tokens', 'refusal', 'other'];

function mapStopReason(value: unknown): AiStopReason {
  return typeof value === 'string' && (STOP_REASONS as readonly string[]).includes(value)
    ? (value as AiStopReason)
    : 'other';
}

function errorKindForStatus(status: number | null, message: string): AiError {
  if (status === 401 || status === 403) return new AiError('auth', message, status);
  if (status === 429) return new AiError('rate-limit', message, status);
  if (status === 529) return new AiError('overloaded', message, status);
  if (status !== null && status >= 400 && status < 500) return new AiError('bad-request', message, status);
  return new AiError('unknown', message, status);
}

function mapThrown(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new AiError('aborted', 'Request aborted');
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return new AiError('aborted', 'Request aborted');
  }
  if (err instanceof TypeError) {
    return new AiError('network', `Network error: ${err.message}`);
  }
  return new AiError('unknown', err instanceof Error ? err.message : String(err));
}

/** Extracts the `error` string from a pre-stream JSON error body, if present. */
async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') {
      return (parsed as { error: string }).error;
    }
  } catch {
    // Non-JSON body; fall back to a status-based message.
  }
  return null;
}

/** Streams an AI analysis through the local agent proxy. */
export async function* streamAgentProxy(
  config: AgentConfig,
  req: AiRequest,
  signal: AbortSignal,
): AsyncGenerator<AiStreamEvent> {
  const url = `${normalizeBaseUrl(config.baseUrl)}/api/ai/analyze`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      signal,
      body: JSON.stringify({
        system: req.system,
        prompt: req.user,
        model: req.model || null,
        maxTokens: req.maxTokens || null,
      }),
    });
  } catch (err) {
    throw mapThrown(err);
  }

  if (!response.ok) {
    const message =
      (await readErrorMessage(response)) ?? `Agent AI request failed (HTTP ${response.status})`;
    throw errorKindForStatus(response.status, message);
  }
  if (!response.body) throw new AiError('unknown', 'Response has no body');

  const reader = response.body.getReader();
  let doneEmitted = false;
  try {
    for await (const message of parseSseStream(reader)) {
      const data = message.data.trim();
      if (!data) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const payload = parsed as {
        text?: unknown;
        stopReason?: unknown;
        explanation?: unknown;
        message?: unknown;
        status?: unknown;
      };
      if (message.event === 'error') {
        const status = typeof payload.status === 'number' ? payload.status : null;
        const errMessage = typeof payload.message === 'string' ? payload.message : 'Agent AI stream error';
        throw errorKindForStatus(status, errMessage);
      }
      if (message.event === 'done') {
        doneEmitted = true;
        const explanation = typeof payload.explanation === 'string' ? payload.explanation : undefined;
        yield {
          type: 'done',
          stopReason: mapStopReason(payload.stopReason),
          ...(explanation !== undefined ? { refusalExplanation: explanation } : {}),
        };
        break;
      }
      // Default (and explicit "delta") events carry text.
      if (typeof payload.text === 'string' && payload.text.length > 0) {
        yield { type: 'text', text: payload.text };
      }
    }
  } catch (err) {
    throw mapThrown(err);
  } finally {
    reader.releaseLock();
  }

  if (!doneEmitted) {
    yield { type: 'done', stopReason: 'end_turn' };
  }
}
