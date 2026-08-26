import { describe, it, expect } from 'vitest';
import { parseSseStream } from '../providers/sse';

function readerFromChunks(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return stream.getReader();
}

async function collect(chunks: string[]) {
  const out: Array<{ event?: string; data: string }> = [];
  for await (const msg of parseSseStream(readerFromChunks(chunks))) out.push(msg);
  return out;
}

describe('parseSseStream', () => {
  it('parses simple data messages', async () => {
    const messages = await collect(['data: hello\n\ndata: world\n\n']);
    expect(messages).toEqual([
      { event: undefined, data: 'hello' },
      { event: undefined, data: 'world' },
    ]);
  });

  it('buffers lines split across chunks', async () => {
    const messages = await collect(['data: hel', 'lo\n', '\ndata: wo', 'rld\n\n']);
    expect(messages.map((m) => m.data)).toEqual(['hello', 'world']);
  });

  it('accumulates event names and multi-line data', async () => {
    const messages = await collect(['event: delta\ndata: line1\ndata: line2\n\n']);
    expect(messages).toEqual([{ event: 'delta', data: 'line1\nline2' }]);
  });

  it('flushes a final message without trailing blank line', async () => {
    const messages = await collect(['event: done\ndata: {"x":1}\n']);
    expect(messages).toEqual([{ event: 'done', data: '{"x":1}' }]);
  });

  it('handles CRLF line endings and comments', async () => {
    const messages = await collect([': ping\r\ndata: a\r\n\r\n']);
    expect(messages).toEqual([{ event: undefined, data: 'a' }]);
  });

  it('decodes multi-byte UTF-8 split across chunks', async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('data: héllo\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 8)); // splits the é
        controller.enqueue(bytes.slice(8));
        controller.close();
      },
    });
    const out: string[] = [];
    for await (const msg of parseSseStream(stream.getReader())) out.push(msg.data);
    expect(out).toEqual(['héllo']);
  });
});
