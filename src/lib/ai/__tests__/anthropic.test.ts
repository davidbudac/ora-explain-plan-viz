import { beforeEach, describe, expect, it, vi } from 'vitest';

// Self-contained SDK mock: minimal error hierarchy + a capturable stream() fn.
const streamMock = vi.fn();
const constructorMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status: number | undefined;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }
  class APIUserAbortError extends APIError {}
  class APIConnectionError extends APIError {}
  class AuthenticationError extends APIError {}
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}

  class Anthropic {
    beta = { messages: { stream: streamMock } };
    constructor(opts: unknown) {
      constructorMock(opts);
    }
    static APIError = APIError;
    static APIUserAbortError = APIUserAbortError;
    static APIConnectionError = APIConnectionError;
    static AuthenticationError = AuthenticationError;
    static RateLimitError = RateLimitError;
    static BadRequestError = BadRequestError;
  }
  return { default: Anthropic };
});

import Anthropic from '@anthropic-ai/sdk';
import { streamAnthropic } from '../providers/anthropic';
import { AiError } from '../types';
import type { AiRequest, AiStreamEvent } from '../types';

const REQ: AiRequest = {
  system: 'You are an Oracle expert.',
  user: 'Analyze this plan.',
  model: 'claude-opus-5',
  maxTokens: 32000,
};

function makeStream(
  deltas: string[],
  finalMessage: Record<string, unknown>,
) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of deltas) {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
      }
      yield { type: 'message_stop' };
    },
    finalMessage: async () => finalMessage,
  };
}

async function collect(gen: AsyncGenerator<AiStreamEvent>): Promise<AiStreamEvent[]> {
  const events: AiStreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

beforeEach(() => {
  streamMock.mockReset();
  constructorMock.mockReset();
});

describe('streamAnthropic', () => {
  it('constructs the client with dangerouslyAllowBrowser and sends no thinking param', async () => {
    streamMock.mockReturnValue(
      makeStream(['hi'], { stop_reason: 'end_turn', stop_details: null }),
    );
    await collect(streamAnthropic({ apiKey: 'sk-test' }, REQ, new AbortController().signal));

    expect(constructorMock).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      dangerouslyAllowBrowser: true,
    });
    const [params, opts] = streamMock.mock.calls[0];
    expect(params).not.toHaveProperty('thinking');
    expect(params).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: 32000,
      system: REQ.system,
      messages: [{ role: 'user', content: REQ.user }],
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('yields text deltas then a done event with end_turn', async () => {
    streamMock.mockReturnValue(
      makeStream(['Hello ', 'world'], { stop_reason: 'end_turn', stop_details: null }),
    );
    const events = await collect(
      streamAnthropic({ apiKey: 'k' }, REQ, new AbortController().signal),
    );
    expect(events).toEqual([
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('maps a refusal stop_reason with the stop_details explanation', async () => {
    streamMock.mockReturnValue(
      makeStream(['partial'], {
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber', explanation: 'Declined.' },
      }),
    );
    const events = await collect(
      streamAnthropic({ apiKey: 'k' }, REQ, new AbortController().signal),
    );
    expect(events[events.length - 1]).toEqual({
      type: 'done',
      stopReason: 'refusal',
      refusalExplanation: 'Declined.',
    });
  });

  it('maps max_tokens and unknown stop reasons', async () => {
    streamMock.mockReturnValue(
      makeStream([], { stop_reason: 'max_tokens', stop_details: null }),
    );
    let events = await collect(
      streamAnthropic({ apiKey: 'k' }, REQ, new AbortController().signal),
    );
    expect(events).toEqual([{ type: 'done', stopReason: 'max_tokens' }]);

    streamMock.mockReturnValue(
      makeStream([], { stop_reason: 'pause_turn', stop_details: null }),
    );
    events = await collect(
      streamAnthropic({ apiKey: 'k' }, REQ, new AbortController().signal),
    );
    expect(events).toEqual([{ type: 'done', stopReason: 'other' }]);
  });

  it('maps AuthenticationError to an AiError with kind auth', async () => {
    streamMock.mockImplementation(() => {
      throw new Anthropic.AuthenticationError('invalid x-api-key', 401);
    });
    const gen = streamAnthropic({ apiKey: 'bad' }, REQ, new AbortController().signal);
    await expect(collect(gen)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).kind).toBe('auth');
      expect((err as AiError).status).toBe(401);
      return true;
    });
  });

  it('maps abort, rate-limit, overload, network and bad-request errors', async () => {
    const cases: Array<[Error, string, number | null]> = [
      [new Anthropic.APIUserAbortError('aborted'), 'aborted', null],
      [new Anthropic.RateLimitError('slow down', 429), 'rate-limit', 429],
      [new Anthropic.APIError('overloaded_error', 529), 'overloaded', 529],
      [new Anthropic.APIConnectionError('conn'), 'network', null],
      [new Anthropic.BadRequestError('bad', 400), 'bad-request', 400],
    ];
    for (const [thrown, kind, status] of cases) {
      streamMock.mockImplementation(() => {
        throw thrown;
      });
      const gen = streamAnthropic({ apiKey: 'k' }, REQ, new AbortController().signal);
      const err = await collect(gen).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).kind).toBe(kind);
      expect((err as AiError).status).toBe(status);
    }
  });
});
