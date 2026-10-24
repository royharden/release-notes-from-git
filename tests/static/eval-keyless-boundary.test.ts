import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : ['.ts', '.tsx'].includes(extname(path)) ? [path] : [];
  });
}
function importClosure(roots: string[]): Set<string> {
  const visited = new Set<string>(); const pending = [...roots];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)) {
      const specifier = match[1]!;
      const target = specifier.startsWith('@shared/') ? resolve(root, 'supabase/functions/_shared/core', specifier.slice(8)) :
        specifier.startsWith('.') ? resolve(dirname(file), specifier) : null;
      if (target !== null && ['.ts', '.tsx'].includes(extname(target))) pending.push(target);
    }
  }
  return visited;
}
describe('keyless evaluation dependency boundary', () => {
  it('neither app nor evaluator transitively imports builder, recorder or a live provider adapter', () => {
    // what_bug_this_catches: a seemingly pure helper imports a credential-reading/network builder indirectly.
    const closure = importClosure([...sourceFiles(resolve(root, 'src')), resolve(root, 'scripts/eval.ts')]);
    for (const path of closure) expect(path.replaceAll('\\', '/')).not.toMatch(/\/(?:build-gold|record-mock|anthropic|openai-compatible)\.ts$/);
  });
  it('reserves heldout before loading its artifacts and keeps recorded failure reservations', () => {
    const text = readFileSync(resolve(root, 'scripts/eval.ts'), 'utf8');
    expect(text.indexOf('reserveHeldout(marker, freeze);')).toBeLessThan(text.indexOf('const ranges = split'));
    expect(text).toContain("{ flag: 'wx' }");
    expect(text).not.toMatch(/(?:unlinkSync|rmSync)\s*\(/);
    expect(text).not.toMatch(/process\.env|\bfetch\s*\(/);
  });
});
