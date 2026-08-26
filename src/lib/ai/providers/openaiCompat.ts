import type { AiRequest, AiStreamEvent } from '../types';
import { AiError } from '../types';
import { parseSseStream } from './sse';

export interface OpenAiCompatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Build the chat-completions endpoint URL, appending /v1 for bare hosts (e.g. Ollama). */
export function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  let hasPath = false;
  try {
    const parsed = new URL(trimmed);
    hasPath = parsed.pathname !== '' && parsed.pathname !== '/';
  } catch {
    hasPath = false;
  }
  return `${trimmed}${hasPath ? '' : '/v1'}/chat/completions`;
}

function errorKindForStatus(status: number): AiError {
  if (status === 401 || status === 403) return new AiError('auth', `Authentication failed (HTTP ${status})`, status);
  if (status === 429) return new AiError('rate-limit', 'Rate limited (HTTP 429)', status);
  if (status === 529) return new AiError('overloaded', 'Provider overloaded (HTTP 529)', status);
  if (status >= 400 && status < 500) return new AiError('bad-request', `Bad request (HTTP ${status})`, status);
  return new AiError('unknown', `Request failed (HTTP ${status})`, status);
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

/**
 * Stream a chat completion from an OpenAI-compatible endpoint
 * (OpenAI, Ollama, LM Studio, vLLM, ...).
 */
export async function* streamOpenAiCompat(
  config: OpenAiCompatConfig,
  req: AiRequest,
  signal: AbortSignal,
): AsyncGenerator<AiStreamEvent> {
  const url = buildChatCompletionsUrl(config.baseUrl);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model: config.model,
        max_tokens: req.maxTokens,
        stream: true,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
    });
  } catch (err) {
    throw mapThrown(err);
  }

  if (!response.ok) throw errorKindForStatus(response.status);
  if (!response.body) throw new AiError('unknown', 'Response has no body');

  const reader = response.body.getReader();
  let doneEmitted = false;
  try {
    for await (const message of parseSseStream(reader)) {
      const data = message.data.trim();
      if (data === '[DONE]') {
        if (!doneEmitted) {
          doneEmitted = true;
          yield { type: 'done', stopReason: 'end_turn' };
        }
        break;
      }
      if (!data) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const choice = (parsed as { choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }> })
        .choices?.[0];
      if (!choice) continue;
      const text = choice.delta?.content;
      if (typeof text === 'string' && text.length > 0) {
        yield { type: 'text', text };
      }
      if (choice.finish_reason === 'length') {
        doneEmitted = true;
        yield { type: 'done', stopReason: 'max_tokens' };
      } else if (choice.finish_reason && !doneEmitted) {
        doneEmitted = true;
        yield { type: 'done', stopReason: 'end_turn' };
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
