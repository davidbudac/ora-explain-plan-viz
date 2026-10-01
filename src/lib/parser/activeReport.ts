/**
 * SQL Monitor ACTIVE report (HTML) support.
 *
 * `DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(type => 'ACTIVE')` returns an HTML page
 * whose data lives in `<script id="fxtmodel" type="text/xml">`:
 *
 *   <report db_version="…" … encode="base64" compress="zlib">
 *     <report_id><![CDATA[…]]></report_id>
 *     {whitespace-wrapped base64 of a zlib stream}
 *   </report>
 *
 * The inflated payload is a regular `<sql_monitor_report>` document. Some
 * variants embed the XML uncompressed in the same script tag. `decodeActiveReport`
 * turns either into plain XML the SQL Monitor XML parser already understands.
 */

/** Only the head of a paste is inspected for detection — the script tag sits near the top. */
const DETECT_WINDOW = 20_000;

const FXTMODEL_SCRIPT = /<script\b[^>]*\bid\s*=\s*["']fxtmodel["'][^>]*>([\s\S]*?)<\/script>/i;
const FXTMODEL_MARK = /\bid\s*=\s*["']fxtmodel["']/i;
const ENCODED_REPORT_TAG = /<report\b[^>]*\bencode\s*=\s*["']base64["']/i;
const REPORT_OPEN = /<report\b([^>]*)>/i;
const REPORT_ID = /<report_id\b[^>]*>[\s\S]*?<\/report_id>/i;

export const ACTIVE_REPORT_DECODE_ERROR =
  "The ACTIVE report's embedded data could not be decoded — re-export it or use type => 'XML'.";

/** Cheap check (head of the text only): is this a SQL Monitor ACTIVE (HTML) report? */
export function isActiveReport(text: string): boolean {
  const head = text.length > DETECT_WINDOW ? text.slice(0, DETECT_WINDOW) : text;
  return FXTMODEL_MARK.test(head) || ENCODED_REPORT_TAG.test(head);
}

async function inflateZlib(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress ACTIVE reports — use type => \'XML\' instead.');
  }
  // A ReadableStream (rather than Blob.stream) also works where Blob has no stream().
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const inflated = source.pipeThrough(new DecompressionStream('deflate'));
  return new Response(inflated).text();
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const compact = value.replace(/\s+/g, '');
  if (!compact || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) {
    throw new Error(ACTIVE_REPORT_DECODE_ERROR);
  }
  const unpadded = compact.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(unpadded + '='.repeat((4 - (unpadded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Drop `encode="…"` / `compress="…"` from a report tag's attribute string. */
function stripEncodingAttributes(attrs: string): string {
  return attrs
    .replace(/\s+(?:encode|compress)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .trim();
}

function openTag(attrs: string): string {
  const cleaned = stripEncodingAttributes(attrs);
  return cleaned ? `<report ${cleaned}>` : '<report>';
}

/**
 * Decode an ACTIVE report into
 * `<report {attributes minus encode/compress}><report_id>…</report_id>{sql_monitor_report}</report>`.
 * Throws a readable Error when the embedded payload is missing, truncated or corrupt.
 */
export async function decodeActiveReport(text: string): Promise<string> {
  const script = FXTMODEL_SCRIPT.exec(text);
  const model = script ? script[1] : text;

  const open = REPORT_OPEN.exec(model);
  const close = model.lastIndexOf('</report>');
  if (!open || close < open.index + open[0].length) {
    throw new Error(ACTIVE_REPORT_DECODE_ERROR);
  }

  const attrs = open[1];
  const inner = model.slice(open.index + open[0].length, close);
  const encoded = /\bencode\s*=\s*["']base64["']/i.test(attrs);

  if (!encoded) {
    // Uncompressed variant: the XML is already readable — just lift it out of the HTML.
    if (!/<sql_monitor_report\b|<plan_monitor\b/i.test(inner)) {
      throw new Error(ACTIVE_REPORT_DECODE_ERROR);
    }
    return `${openTag(attrs)}${inner}</report>`;
  }

  const reportId = REPORT_ID.exec(inner)?.[0] ?? '';
  const payload = inner.replace(REPORT_ID, '');

  let xml: string;
  try {
    xml = await inflateZlib(base64ToBytes(payload));
  } catch {
    throw new Error(ACTIVE_REPORT_DECODE_ERROR);
  }

  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  xml = xml.replace(/^\s*<\?xml[^>]*\?>/i, '').trim();
  if (!/<sql_monitor_report\b|<plan_monitor\b/i.test(xml)) {
    throw new Error(ACTIVE_REPORT_DECODE_ERROR);
  }
  return `${openTag(attrs)}${reportId}${xml}</report>`;
}
