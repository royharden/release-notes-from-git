import { tokenize } from '../core/support/tokenize.ts';
import { stem } from '../core/support/stem.ts';

/** React text children only: input is never parsed as HTML or Markdown. */
export function Highlight({ text, matched = [], missing = [] }: { text: string; matched?: readonly string[]; missing?: readonly string[] }) {
  const matchedSet = new Set(matched);
  const missingSet = new Set(missing);
  return <>{text.split(/(\s+)/u).map((part, index) => {
    const terms = tokenize(part).map(stem);
    const bad = terms.some((term) => missingSet.has(term));
    const good = !bad && terms.some((term) => matchedSet.has(term));
    return good || bad ? <mark key={index} className={bad ? 'term-missing' : 'term-matched'}>{part}</mark> : <span key={index}>{part}</span>;
  })}</>;
}
