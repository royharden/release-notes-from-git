// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { resolveMode } from '../../src/lib/mode.ts';
import { keyboardAction } from '../../src/ui/keyboard.ts';

afterEach(() => { document.body.replaceChildren(); });
describe('offline and setup mode selection', () => {
  it('defaults keyless to demo, permits explicit demo, and refuses partial live setup', () => {
    expect(resolveMode({}, '')).toEqual({ kind: 'demo' });
    expect(resolveMode({ VITE_SUPABASE_URL: 'https://example.test' }, '?demo=1')).toEqual({ kind: 'demo' });
    expect(resolveMode({ VITE_SUPABASE_URL: 'https://example.test' }, '')).toMatchObject({ kind: 'setup' });
    expect(resolveMode({ VITE_SUPABASE_ANON_KEY: 'public-example' }, '?demo=0')).toMatchObject({ kind: 'setup' });
    expect(resolveMode({}, '?demo=0')).toMatchObject({ kind: 'setup' });
    expect(resolveMode({ VITE_SUPABASE_URL: 'https://example.test', VITE_SUPABASE_ANON_KEY: 'public-example' }, '')).toEqual({ kind: 'live' });
  });
});
describe('review keyboard map', () => {
  it.each([['j', 'next'], ['k', 'previous'], ['1', 'kept'], ['2', 'dropped'], ['3', 'uncovered'], ['4', 'internal'], ['e', 'edit'], ['r', 'restore'], ['x', 'remove'], ['a', 'add'], ['d', 'download'], ['?', 'help']] as const)('maps %s to %s', (key, action) => {
    expect(keyboardAction(new KeyboardEvent('keydown', { key }))).toBe(action);
  });
  it('maps Shift+A but ignores modified browser shortcuts', () => {
    expect(keyboardAction(new KeyboardEvent('keydown', { key: 'A', shiftKey: true }))).toBe('addAll');
    expect(keyboardAction(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }))).toBeNull();
    expect(keyboardAction(new KeyboardEvent('keydown', { key: 'a', metaKey: true }))).toBeNull();
  });
  it.each(['input', 'textarea', 'select', 'div'])('does not intercept typing in %s', (tag) => {
    const field = document.createElement(tag);
    if (tag === 'div') field.setAttribute('contenteditable', 'true');
    const child = tag === 'div' ? document.createElement('span') : field;
    if (child !== field) field.append(child);
    document.body.append(field);
    let result: ReturnType<typeof keyboardAction> = 'add';
    child.addEventListener('keydown', (event) => { result = keyboardAction(event as KeyboardEvent); });
    child.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(result).toBeNull();
  });
});
