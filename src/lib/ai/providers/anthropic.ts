import Anthropic from '@anthropic-ai/sdk';
import type { AiRequest, AiStreamEvent, AiStopReason, AiErrorKind } from '../types';
import { AiError } from '../types';

/** Map an SDK stop_reason (+ optional stop_details) to our AiStopReason. */
function mapStopReason(stopReason: string | null | undefined): AiStopReason {
  switch (stopReason) {
    case 'end_turn':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

/** Translate an SDK (or abort) error into a typed AiError. */
function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (
    err instanceof Anthropic.APIUserAbortError ||
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  ) {
    return new AiError('aborted', 'Request cancelled');
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError('auth', 'Invalid API key', err.status ?? 401);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError('rate-limit', 'Rate limited — retry later', err.status ?? 429);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError('network', 'Could not reach api.anthropic.com');
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AiError('bad-request', err.message, err.status ?? 400);
  }
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === 'number' ? err.status : null;
    const kind: AiErrorKind =
      status === 529 || /overloaded/i.test(err.message) ? 'overloaded' : 'unknown';
    return new AiError(kind, err.message, status);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new AiError('unknown', message);
}

/**
 * Stream an analysis from the Anthropic API directly from the browser
 * (BYO key; `dangerouslyAllowBrowser` enables the CORS path).
 *
 * No `thinking` parameter is sent — claude-opus-5 runs adaptive thinking by
 * default. The server-side refusal fallback is enabled so a policy decline
 * reroutes instead of returning an empty report.
 */
export async function* streamAnthropic(
  config: { apiKey: string },
  req: AiRequest,
  signal: AbortSignal,
): AsyncGenerator<AiStreamEvent> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: true,
  });

  try {
    const stream = client.beta.messages.stream(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      { signal },
    );

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta' &&
        event.delta.text
      ) {
        yield { type: 'text', text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    const stopReason = mapStopReason(final.stop_reason);
    if (stopReason === 'refusal') {
      const details = final.stop_details as { explanation?: string } | null | undefined;
      yield {
        type: 'done',
        stopReason,
        ...(details?.explanation ? { refusalExplanation: details.explanation } : {}),
      };
    } else {
      yield { type: 'done', stopReason };
    }
  } catch (err) {
    throw toAiError(err);
  }
}
