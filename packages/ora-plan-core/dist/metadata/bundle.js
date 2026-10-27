/**
 * Cheap detection of bundle content anywhere in a piece of text, before any
 * cleanup. Used to route pasted or dropped input toward the bundle pipeline
 * regardless of file extension or surrounding SQL*Plus noise. `\s*` also
 * matches line breaks, so a `"format"` / `:` / value split across lines
 * still counts.
 */
export function looksLikeMetadataBundle(text) {
    return /"format"\s*:\s*"ora-plan-metadata"/.test(text);
}
const BUNDLE_OPENER = '{"format"';
function isWhitespace(code) {
    return code === 32 || (code >= 9 && code <= 13) || code === 0xa0 || code === 0xfeff;
}
/** Index of the `{` that opens the bundle, or -1 when there is none. */
function findBundleStart(text) {
    // Terminals can hard-wrap anywhere, so `{"for` / `mat"` may sit on two
    // lines: compare the opener while skipping all whitespace.
    for (let i = text.indexOf('{'); i !== -1; i = text.indexOf('{', i + 1)) {
        let k = 1;
        let j = i + 1;
        while (k < BUNDLE_OPENER.length && j < text.length) {
            const c = text.charCodeAt(j);
            if (isWhitespace(c)) {
                j++;
                continue;
            }
            if (c !== BUNDLE_OPENER.charCodeAt(k))
                break;
            k++;
            j++;
        }
        if (k === BUNDLE_OPENER.length)
            return i;
    }
    // No recognisable opener: fall back to the first `{` that starts a line.
    const m = /^[ \t]*\{/m.exec(text);
    return m ? m.index + m[0].length - 1 : -1;
}
/** Drop every raw line break together with the spaces/tabs padding before it. */
function joinLines(text) {
    const parts = [];
    let from = 0;
    let i = 0;
    while (i < text.length) {
        const c = text.charCodeAt(i);
        if (c === 32 || c === 9) {
            let j = i + 1;
            while (j < text.length && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9))
                j++;
            const next = j < text.length ? text.charCodeAt(j) : -1;
            if (next === 10 || next === 13) {
                parts.push(text.slice(from, i));
                i = j;
                from = j;
            }
            else {
                i = j;
            }
        }
        else if (c === 10 || c === 13) {
            parts.push(text.slice(from, i));
            i++;
            from = i;
        }
        else {
            i++;
        }
    }
    parts.push(text.slice(from));
    return parts.join('');
}
/** Locate and clean the bundle JSON inside arbitrary text; null when no bundle starts. */
function scanBundle(text) {
    const src = text.replace(/^\uFEFF/, '');
    const start = findBundleStart(src);
    if (start === -1)
        return null;
    const s = joinLines(src.slice(start));
    const parts = [];
    let from = 0;
    let inString = false;
    let escaped = false;
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (inString) {
            if (escaped) {
                escaped = false;
            }
            else if (c === 92) {
                escaped = true;
            }
            else if (c === 34) {
                inString = false;
            }
            else if (c < 0x20) {
                // A stray control character (form feed, NUL, tab...) is illegal raw in a JSON string.
                parts.push(s.slice(from, i), `\\u${c.toString(16).padStart(4, '0')}`);
                from = i + 1;
            }
        }
        else if (c === 34) {
            inString = true;
        }
        else if (c === 123 || c === 91) {
            depth++;
        }
        else if (c === 125 || c === 93) {
            depth--;
            if (depth === 0) {
                parts.push(s.slice(from, i + 1));
                return { json: parts.join(''), closed: true };
            }
        }
    }
    parts.push(s.slice(from));
    return { json: parts.join(''), closed: false };
}
/**
 * Recover the bundle JSON from pasted terminal output or a SQL*Plus spool
 * file, or null when no bundle start is found. Such text is rarely clean
 * JSON: prompt echo (`SQL> SQL>   2   3 ...`) can share a line with the
 * payload, marker and status lines sit around it, and the gather script emits
 * the bundle through DBMS_OUTPUT in chunks, so raw line breaks land inside the
 * JSON (even mid-string); terminals may also hard-wrap long lines and pad them
 * with trailing spaces. All legitimate newlines and tabs in values are escaped
 * (`\n`, `\t`) by the script, so raw line breaks carry no information and
 * removing them is lossless.
 *
 * The start is the first `{` followed (ignoring whitespace) by `"format"`,
 * else the first `{` that opens a line. From there line breaks and the
 * spaces/tabs before them are removed, then a JSON-aware scan finds the brace
 * that closes the top-level object and drops everything after it, escaping
 * raw control characters inside strings. When the object never closes, the
 * cleaned remainder is returned and `parseBundle` reports it as cut off.
 */
export function extractBundleJson(text) {
    return scanBundle(text)?.json ?? null;
}
/**
 * Warning to surface when a structurally valid bundle carries no objects —
 * typically the gather script found nothing for the given SQL_ID.
 */
export function emptyBundleWarning(bundle) {
    if (Object.keys(bundle.objects).length > 0)
        return null;
    return bundle.coverage_warnings.length > 0
        ? 'Bundle contains no objects — see its coverage warnings for why the gather came back empty.'
        : 'Bundle contains no objects — the SQL_ID may have aged out of the cursor cache and AWR when the script ran.';
}
export const SUPPORTED_BUNDLE_VERSIONS = [1, 2, 3];
export function parseBundle(input) {
    let parsed;
    try {
        parsed = JSON.parse(input);
    }
    catch {
        const scan = scanBundle(input);
        if (!scan) {
            throw new Error('No metadata bundle found in the pasted text — expected JSON starting with {"format":"ora-plan-metadata"…');
        }
        if (!scan.closed) {
            throw new Error('Metadata bundle looks cut off — the JSON ends before its closing brace. Copy everything up to the END marker (or the whole bundle.json).');
        }
        try {
            parsed = JSON.parse(scan.json);
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(`Bundle is not valid JSON: ${detail}`);
        }
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Bundle is not an object');
    }
    const obj = parsed;
    if (typeof obj.format !== 'string') {
        throw new Error('Bundle is missing required field: format');
    }
    if (obj.format !== 'ora-plan-metadata') {
        throw new Error(`Bundle has unexpected format: "${obj.format}" (expected "ora-plan-metadata")`);
    }
    if (!SUPPORTED_BUNDLE_VERSIONS.includes(obj.version)) {
        throw new Error(`Bundle has unsupported version: ${String(obj.version)} (this build supports versions ${SUPPORTED_BUNDLE_VERSIONS.join(', ')})`);
    }
    if (typeof obj.plan_ref !== 'object' || obj.plan_ref === null) {
        throw new Error('Bundle is missing required field: plan_ref');
    }
    if (typeof obj.objects !== 'object' || obj.objects === null) {
        throw new Error('Bundle is missing required field: objects');
    }
    return parsed;
}
