export type KeyboardAction = 'next' | 'previous' | 'kept' | 'dropped' | 'uncovered' | 'internal' | 'edit' | 'restore' | 'remove' | 'add' | 'addAll' | 'download' | 'help';
export const SHORTCUTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'j / k', label: 'Next / previous item' }, { key: '1–4', label: 'Switch review tab' },
  { key: 'e', label: 'Edit selected bullet' }, { key: 'r', label: 'Restore selected drop' },
  { key: 'x', label: 'Remove selected bullet' }, { key: 'a', label: 'Add selected literal' },
  { key: 'Shift+A', label: 'Add all uncovered literals' }, { key: 'd', label: 'Download approved Markdown' },
  { key: '?', label: 'Show keyboard help' },
];
export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}
export function keyboardAction(event: KeyboardEvent): KeyboardAction | null {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return null;
  if (event.key === 'A' && event.shiftKey) return 'addAll';
  const actions: Record<string, KeyboardAction> = { j: 'next', k: 'previous', '1': 'kept', '2': 'dropped', '3': 'uncovered', '4': 'internal', e: 'edit', r: 'restore', x: 'remove', a: 'add', d: 'download', '?': 'help' };
  return actions[event.key] ?? null;
}
