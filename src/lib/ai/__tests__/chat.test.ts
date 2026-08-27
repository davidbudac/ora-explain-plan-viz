import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Self-contained SDK mock (same shape as anthropic.test.ts) so the anthropic
// branch of streamChat can be exercised without the real SDK.
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

import { flattenChatToPrompt, streamChat } from '../provider';
import { AiError } from '../types';
import type { AiChatMessage, AiStreamEvent } from '../types';

const MESSAGES: AiChatMessage[] = [
  { role: 'user', content: 'Analyze this plan.' },
  { role: 'assistant', content: 'Here is the report.' },
  { role: 'user', content: 'Why is line 3 slow?' },
];

const OPTS = {
  system: 'You are an Oracle expert.',
  messages: MESSAGES,
  model: 'claude-opus-5',
  maxTokens: 32000,
};

function makeSdkStream(deltas: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of deltas) {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
      }
    },
    finalMessage: async () => ({ stop_reason: 'end_turn', stop_details: null }),
  };
}

function sseResponse(lines: string[]): Response {
  return new Response(lines.join('\n') + '\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function collect(gen: AsyncGenerator<AiStreamEvent>): Promise<AiStreamEvent[]> {
  const events: AiStreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('flattenChatToPrompt', () => {
  it('quotes every turn with User:/Assistant: delimiters and a leading note', () => {
    const prompt = flattenChatToPrompt(MESSAGES);
    expect(prompt).toContain('multi-turn conversation');
    const userIdx = prompt.indexOf('User:\nAnalyze this plan.');
    const assistantIdx = prompt.indexOf('Assistant:\nHere is the report.');
    const followUpIdx = prompt.indexOf('User:\nWhy is line 3 slow?');
    expect(userIdx).toBeGreaterThan(-1);
    expect(assistantIdx).toBeGreaterThan(userIdx);
    expect(followUpIdx).toBeGreaterThan(assistantIdx);
  });
});

describe('streamChat — anthropic', () => {
  beforeEach(() => {
    streamMock.mockReset();
    constructorMock.mockReset();
  });

  it('passes the full messages array to the SDK stream', async () => {
    streamMock.mockReturnValue(makeSdkStream(['Because of the full scan.']));

    const events = await collect(
      streamChat(
        { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-opus-5' },
        OPTS,
        new AbortController().signal,
      ),
    );

    const [params] = streamMock.mock.calls[0];
    expect(params).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: 32000,
      system: OPTS.system,
      messages: MESSAGES,
    });
    expect(events[0]).toEqual({ type: 'text', text: 'Because of the full scan.' });
    expect(events[events.length - 1]).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('throws bad-request when the API key is missing', () => {
    expect(() =>
      streamChat({ provider: 'anthropic', model: 'claude-opus-5' }, OPTS, new AbortController().signal),
    ).toThrowError(AiError);
  });
});

describe('streamChat — fetch providers', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('openai-compat maps the chat messages after the system message', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}',
        '',
        'data: [DONE]',
        '',
      ]),
    );

    const events = await collect(
      streamChat(
        { provider: 'openai-compat', baseUrl: 'http://localhost:11434', apiKey: '', model: 'llama3' },
        OPTS,
        new AbortController().signal,
      ),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages).toEqual([
      { role: 'system', content: OPTS.system },
      ...MESSAGES,
    ]);
    // The chat opts' model wins (streamChat sends opts.model, not the runConfig default).
    expect(body.model).toBe(OPTS.model);
    expect(events[0]).toEqual({ type: 'text', text: 'Hi' });
  });

  it('agent flattens prior turns into the prompt on the same /analyze endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'event: delta',
        'data: {"text":"ok"}',
        '',
        'event: done',
        'data: {"stopReason":"end_turn"}',
        '',
      ]),
    );

    await collect(
      streamChat(
        {
          provider: 'agent',
          model: '',
          agent: { baseUrl: 'http://127.0.0.1:8521', token: 'tok' },
        },
        OPTS,
        new AbortController().signal,
      ),
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8521/api/ai/analyze');
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe(OPTS.system);
    expect(body.prompt).toContain('User:\nAnalyze this plan.');
    expect(body.prompt).toContain('Assistant:\nHere is the report.');
    expect(body.prompt).toContain('User:\nWhy is line 3 slow?');
  });

  it('hosted flattens prior turns into the prompt on /v1/analyze', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'event: done',
        'data: {"stopReason":"end_turn"}',
        '',
      ]),
    );

    await collect(
      streamChat(
        { provider: 'hosted', model: '', accountToken: 'acct' },
        OPTS,
        new AbortController().signal,
      ),
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.oraplanviz.com/v1/analyze');
    const body = JSON.parse(init.body as string);
    expect(body.prompt).toContain('Assistant:\nHere is the report.');
    expect(body.prompt).toContain('User:\nWhy is line 3 slow?');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer acct');
  });
});
