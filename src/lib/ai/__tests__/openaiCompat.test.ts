import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamOpenAiCompat, buildChatCompletionsUrl } from '../providers/openaiCompat';
import { AiError } from '../types';
import type { AiRequest, AiStreamEvent } from '../types';

const req: AiRequest = {
  system: 'sys prompt',
  user: 'user prompt',
  model: 'ignored',
  maxTokens: 4096,
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

function delta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
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
});

describe('buildChatCompletionsUrl', () => {
  it('appends /v1 for a bare host', () => {
    expect(buildChatCompletionsUrl('http://localhost:11434')).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
  });

  it('does not append /v1 when a path is present', () => {
    expect(buildChatCompletionsUrl('https://api.example.com/v1')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
    expect(buildChatCompletionsUrl('https://api.example.com/openai/v1/')).toBe(
      'https://api.example.com/openai/v1/chat/completions',
    );
  });
});

describe('streamOpenAiCompat', () => {
  it('yields text deltas and done on [DONE], with correct URL/headers/body', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([delta('Hello'), delta(' world'), 'data: [DONE]\n\n']),
    );

    const events = await collect(
      streamOpenAiCompat(
        { baseUrl: 'https://api.openai.com', apiKey: 'sk-test', model: 'gpt-4o' },
        req,
        new AbortController().signal,
      ),
    );

    expect(events).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done', stopReason: 'end_turn' },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      model: 'gpt-4o',
      max_tokens: 4096,
      stream: true,
      messages: [
        { role: 'system', content: 'sys prompt' },
        { role: 'user', content: 'user prompt' },
      ],
    });
  });

  it('handles a chunk split mid-line', async () => {
    const full = delta('abc') + delta('def') + 'data: [DONE]\n\n';
    const mid = Math.floor(full.length / 2) + 3; // inside a data line
    fetchMock.mockResolvedValue(sseResponse([full.slice(0, mid), full.slice(mid)]));

    const events = await collect(
      streamOpenAiCompat(
        { baseUrl: 'http://localhost:11434', apiKey: '', model: 'llama3' },
        req,
        new AbortController().signal,
      ),
    );
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text)).toEqual([
      'abc',
      'def',
    ]);
    expect(events[events.length - 1]).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('omits Authorization header when apiKey is empty and does not append /v1 to path URLs', async () => {
    fetchMock.mockResolvedValue(sseResponse(['data: [DONE]\n\n']));

    await collect(
      streamOpenAiCompat(
        { baseUrl: 'https://example.com/custom/v1', apiKey: '', model: 'm' },
        req,
        new AbortController().signal,
      ),
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/custom/v1/chat/completions');
    expect('Authorization' in init.headers).toBe(false);
  });

  it("maps finish_reason 'length' to done max_tokens", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        delta('partial'),
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    );

    const events = await collect(
      streamOpenAiCompat(
        { baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'm' },
        req,
        new AbortController().signal,
      ),
    );
    expect(events).toEqual([
      { type: 'text', text: 'partial' },
      { type: 'done', stopReason: 'max_tokens' },
    ]);
  });

  it('maps 401 to AiError kind auth', async () => {
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }));

    const gen = streamOpenAiCompat(
      { baseUrl: 'https://api.openai.com', apiKey: 'bad', model: 'm' },
      req,
      new AbortController().signal,
    );
    const err = await gen.next().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).kind).toBe('auth');
    expect((err as AiError).status).toBe(401);
  });

  it('maps 429 / 529 / other 4xx / 5xx statuses', async () => {
    const cases: Array<[number, string]> = [
      [429, 'rate-limit'],
      [529, 'overloaded'],
      [400, 'bad-request'],
      [500, 'unknown'],
    ];
    for (const [status, kind] of cases) {
      fetchMock.mockResolvedValueOnce(new Response('err', { status }));
      const gen = streamOpenAiCompat(
        { baseUrl: 'https://x.test', apiKey: 'k', model: 'm' },
        req,
        new AbortController().signal,
      );
      const err = (await gen.next().catch((e: unknown) => e)) as AiError;
      expect(err.kind).toBe(kind);
      expect(err.status).toBe(status);
    }
  });

  it('maps abort to AiError kind aborted', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));

    const controller = new AbortController();
    controller.abort();
    const gen = streamOpenAiCompat(
      { baseUrl: 'https://api.openai.com', apiKey: 'k', model: 'm' },
      req,
      controller.signal,
    );
    const err = (await gen.next().catch((e: unknown) => e)) as AiError;
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('aborted');
  });

  it('maps fetch TypeError to AiError kind network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const gen = streamOpenAiCompat(
      { baseUrl: 'https://unreachable.test', apiKey: 'k', model: 'm' },
      req,
      new AbortController().signal,
    );
    const err = (await gen.next().catch((e: unknown) => e)) as AiError;
    expect(err.kind).toBe('network');
  });

  it('yields done end_turn when the stream ends without [DONE]', async () => {
    fetchMock.mockResolvedValue(sseResponse([delta('x')]));

    const events = await collect(
      streamOpenAiCompat(
        { baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'm' },
        req,
        new AbortController().signal,
      ),
    );
    expect(events).toEqual([
      { type: 'text', text: 'x' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });
});
