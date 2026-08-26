import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamAgentProxy } from '../providers/agent';
import { AiError } from '../types';
import type { AiRequest, AiStreamEvent } from '../types';

const config = { baseUrl: 'http://127.0.0.1:8521', token: 'tok-123' };

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
});

describe('streamAgentProxy', () => {
  it('yields text deltas and done, with correct URL/headers/body', async () => {
    fetchMock.mockResolvedValue(sseResponse([delta('Hello'), delta(' world'), done('end_turn')]));

    const events = await collect(streamAgentProxy(config, req, new AbortController().signal));

    expect(events).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done', stopReason: 'end_turn' },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8521/api/ai/analyze');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-123');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      system: 'sys prompt',
      prompt: 'user prompt',
      model: 'claude-opus-5',
      maxTokens: 32000,
    });
  });

  it('strips a trailing slash from the base URL and nulls empty model/maxTokens', async () => {
    fetchMock.mockResolvedValue(sseResponse([done('end_turn')]));

    await collect(
      streamAgentProxy(
        { baseUrl: 'http://127.0.0.1:8521/', token: 't' },
        { ...req, model: '', maxTokens: 0 },
        new AbortController().signal,
      ),
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8521/api/ai/analyze');
    const body = JSON.parse(init.body);
    expect(body.model).toBeNull();
    expect(body.maxTokens).toBeNull();
  });

  it('handles a chunk split mid-line', async () => {
    const full = delta('abc') + delta('def') + done('end_turn');
    const mid = Math.floor(full.length / 2) + 3; // inside a data line
    fetchMock.mockResolvedValue(sseResponse([full.slice(0, mid), full.slice(mid)]));

    const events = await collect(streamAgentProxy(config, req, new AbortController().signal));
    expect(events).toEqual([
      { type: 'text', text: 'abc' },
      { type: 'text', text: 'def' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('passes through known stop reasons and the refusal explanation', async () => {
    fetchMock.mockResolvedValue(sseResponse([delta('partial'), done('refusal', 'cannot comply')]));

    const events = await collect(streamAgentProxy(config, req, new AbortController().signal));
    expect(events).toEqual([
      { type: 'text', text: 'partial' },
      { type: 'done', stopReason: 'refusal', refusalExplanation: 'cannot comply' },
    ]);
  });

  it("maps an unknown stopReason to 'other'", async () => {
    fetchMock.mockResolvedValue(sseResponse([done('something_new')]));

    const events = await collect(streamAgentProxy(config, req, new AbortController().signal));
    expect(events).toEqual([{ type: 'done', stopReason: 'other' }]);
  });

  it('throws AiError from an in-stream error event, mapping status to kind', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        delta('x'),
        `event: error\ndata: ${JSON.stringify({ message: 'rate limited upstream', status: 429 })}\n\n`,
      ]),
    );

    const gen = streamAgentProxy(config, req, new AbortController().signal);
    expect((await gen.next()).value).toEqual({ type: 'text', text: 'x' });
    const err = (await gen.next().catch((e: unknown) => e)) as AiError;
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('rate-limit');
    expect(err.status).toBe(429);
    expect(err.message).toBe('rate limited upstream');
  });

  it('maps an in-stream error event without status to kind unknown', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([`event: error\ndata: ${JSON.stringify({ message: 'boom' })}\n\n`]),
    );

    const gen = streamAgentProxy(config, req, new AbortController().signal);
    const err = (await gen.next().catch((e: unknown) => e)) as AiError;
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('unknown');
    expect(err.status).toBeNull();
    expect(err.message).toBe('boom');
  });

  it('maps a pre-stream 401 JSON error to AiError kind auth with the server message', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid token' }), { status: 401 }),
    );

    const gen = streamAgentProxy(config, req, new AbortController().signal);
    const err = (await gen.next().catch((e: unknown) => e)) as AiError;
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('auth');
    expect(err.status).toBe(401);
    expect(err.message).toBe('invalid token');
  });

  it('maps a pre-stream 500 error to AiError kind unknown', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'upstream exploded' }), { status: 500 }),
    );

    const gen = streamAgentProxy(config, req, new AbortController().signal);
    const err = (await gen.next().catch((e: unknown) => e)) as AiError;
    expect(err.kind).toBe('unknown');
    expect(err.status).toBe(500);
    expect(err.message).toBe('upstream exploded');
  });

  it('falls back to a status message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 400 }));

    const gen = streamAgentProxy(config, req, new AbortController().signal);
    const err = (await gen.next().catch((e: unknown) => e)) as AiError;
    expect(err.kind).toBe('bad-request');
    expect(err.status).toBe(400);
    expect(err.message).toContain('400');
  });

  it('maps abort to AiError kind aborted', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));

    const controller = new AbortController();
    controller.abort();
    const gen = streamAgentProxy(config, req, controller.signal);
    const err = (await gen.next().catch((e: unknown) => e)) as AiError;
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('aborted');
  });

  it('maps fetch TypeError to AiError kind network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const gen = streamAgentProxy(config, req, new AbortController().signal);
    const err = (await gen.next().catch((e: unknown) => e)) as AiError;
    expect(err.kind).toBe('network');
  });

  it('yields done end_turn when the stream ends without a done event', async () => {
    fetchMock.mockResolvedValue(sseResponse([delta('x')]));

    const events = await collect(streamAgentProxy(config, req, new AbortController().signal));
    expect(events).toEqual([
      { type: 'text', text: 'x' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });
});
