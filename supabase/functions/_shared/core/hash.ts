// SHA-256 (WebCrypto) and canonical JSON, shared by the browser and the edge function. Web APIs only.

const encoder = new TextEncoder();

/** Lower-case hex SHA-256 of the UTF-8 encoding of `text`. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  let out = '';
  for (const byte of new Uint8Array(digest)) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Canonical JSON: object keys sorted (UTF-16 code unit order), no whitespace, arrays in order.
 * Object properties whose value is undefined are omitted (JSON.stringify semantics); undefined array
 * items, array holes, non-finite numbers, and non-plain objects throw, so a hash never silently covers
 * something other than what the caller meant.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      return Array.isArray(value) ? canonicalArray(value) : canonicalObject(value);
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
}

function canonicalArray(items: readonly unknown[]): string {
  const parts: string[] = [];
  for (let i = 0; i < items.length; i++) {
    if (!(i in items) || items[i] === undefined) throw new TypeError(`canonicalJson: undefined array item at ${i}`);
    parts.push(canonicalJson(items[i]));
  }
  return `[${parts.join(',')}]`;
}

function canonicalObject(value: object): string {
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError('canonicalJson: only plain objects');
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/** sha256Hex(canonicalJson(value)). */
export function sha256Canonical(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}
