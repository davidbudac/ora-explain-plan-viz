/**
 * Minimal Server-Sent Events (SSE) parser shared by the streaming providers.
 *
 * Reads raw bytes from a fetch response body reader, decodes UTF-8
 * incrementally, and yields one message per blank-line-terminated SSE event.
 */

export async function* parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<{ event?: string; data: string }> {
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName: string | undefined;
  let dataLines: string[] = [];

  const flush = (): { event?: string; data: string } | null => {
    if (dataLines.length === 0 && eventName === undefined) return null;
    const message = { event: eventName, data: dataLines.join('\n') };
    eventName = undefined;
    dataLines = [];
    return message;
  };

  const handleLine = (rawLine: string): { event?: string; data: string } | null => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') return flush();
    if (line.startsWith(':')) return null; // comment
    if (line.startsWith('event:')) {
      eventName = line.slice(6).replace(/^ /, '');
      return null;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
      return null;
    }
    return null;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      const message = handleLine(line);
      if (message) yield message;
    }
  }

  // Flush any trailing decoder state and buffered final line/message.
  buffer += decoder.decode();
  if (buffer !== '') {
    const message = handleLine(buffer);
    if (message) yield message;
  }
  const final = flush();
  if (final) yield final;
}
