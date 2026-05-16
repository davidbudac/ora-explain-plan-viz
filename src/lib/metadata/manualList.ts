export interface ManualObjectEntry {
  owner: string;
  name: string;
}

export interface ParseManualListResult {
  items: ManualObjectEntry[];
  errors: string[];
}

const IDENT = /^(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$#]*)$/;

function stripQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s.toUpperCase();
}

export function parseManualObjectList(text: string): ParseManualListResult {
  const items: ManualObjectEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  const tokens = text
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  for (const token of tokens) {
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) {
      errors.push(`"${token}" is not OWNER.OBJECT`);
      continue;
    }
    const ownerRaw = token.slice(0, dot);
    const nameRaw = token.slice(dot + 1);
    if (!IDENT.test(ownerRaw) || !IDENT.test(nameRaw)) {
      errors.push(`"${token}" is not a valid identifier`);
      continue;
    }
    const owner = stripQuotes(ownerRaw);
    const name = stripQuotes(nameRaw);
    const key = `${owner}.${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ owner, name });
  }

  return { items, errors };
}

export function formatManualListArg(items: ManualObjectEntry[]): string {
  return items.map((i) => `${i.owner}.${i.name}`).join(',');
}
