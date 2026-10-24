// release-notes.md: fixed section order, empty sections omitted, security bullets under Fixes with a code-generated
// "Security:" label, citations as `[abc1234]` linked only to a validated https base_url, visible human_attested
// marker, footer with six counts. Version and date come only from user input.

import type { Category } from '../../../supabase/functions/_shared/core/output-schema.ts';
import type { Attestation, BulletOrigin } from '../rulings/types.ts';
import { escapeInline } from './escape.ts';

export const SECTIONS = [
  { title: 'Breaking', categories: ['breaking'] },
  { title: 'Features', categories: ['feature'] },
  { title: 'Fixes', categories: ['fix', 'security'] },
  { title: 'Performance', categories: ['performance'] },
  { title: 'Other', categories: ['other'] },
] as const satisfies readonly { title: string; categories: readonly Category[] }[];
export type SectionTitle = (typeof SECTIONS)[number]['title'];

export function sectionOf(category: Category): SectionTitle {
  for (const section of SECTIONS) if ((section.categories as readonly Category[]).includes(category)) return section.title;
  return 'Other';
}

export const SECURITY_LABEL = 'Security: ';
export const ATTESTED_MARKER = '(human_attested)';

export interface ExportCounts {
  generated: number;
  validator_kept: number;
  validator_dropped: number;
  human_removed: number;
  human_restored: number;
  human_added: number;
}

export interface ExportedBullet {
  key: string;
  text: string;
  category: Category;
  /** Resolved full shas of the active cited commits, sorted. */
  cites: string[];
  attestation: Attestation;
  origin: BulletOrigin;
}

export interface ExportDocument {
  version: string;
  date: string;
  base_url: string | null;
  bullets: ExportedBullet[];
  counts: ExportCounts;
}

const SAFE_URL = /^[A-Za-z0-9\-._~/:%]+$/;
const HEX_SHA = /^[0-9a-f]{7,64}$/;

/**
 * The commit-link base for a base_url, or null when it must not be linked: only https, no credentials, query or
 * fragment, and only URL-safe characters (so the link destination cannot break out of Markdown).
 * Links are `<base>/commit/<full-sha>` (GitHub-compatible convention).
 */
export function commitLinkBase(baseUrl: string | null): string | null {
  if (baseUrl === null) return null;
  const raw = baseUrl.trim();
  if (raw === '' || !SAFE_URL.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname === '') return null;
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function renderCitation(sha: string, linkBase: string | null): string {
  if (!HEX_SHA.test(sha)) return `\\[${escapeInline(sha)}\\]`;
  const label = `[${sha.slice(0, 7)}]`;
  return linkBase === null || sha.length < 40 ? label : `${label}(${linkBase}/commit/${sha})`;
}

export function renderBulletLine(bullet: ExportedBullet, linkBase: string | null): string {
  const prefix = bullet.category === 'security' ? SECURITY_LABEL : '';
  const cites = bullet.cites.map((sha) => renderCitation(sha, linkBase)).join(' ');
  const marker = bullet.attestation === 'human_attested' ? ` ${ATTESTED_MARKER}` : '';
  return `- ${prefix}${escapeInline(bullet.text)}${cites === '' ? '' : ` ${cites}`}${marker}`;
}

export function renderFooter(counts: ExportCounts): string {
  return [
    `Generated: ${counts.generated}`,
    `validator kept: ${counts.validator_kept}`,
    `validator dropped: ${counts.validator_dropped}`,
    `human-removed: ${counts.human_removed}`,
    `human-restored: ${counts.human_restored}`,
    `human-added: ${counts.human_added}`,
  ].join('; ');
}

export function renderMarkdown(doc: ExportDocument): string {
  const linkBase = commitLinkBase(doc.base_url);
  const lines: string[] = [`# ${escapeInline(doc.version)} (${escapeInline(doc.date)})`, ''];
  let any = false;
  for (const section of SECTIONS) {
    const bullets = doc.bullets.filter((b) => sectionOf(b.category) === section.title);
    if (bullets.length === 0) continue;
    any = true;
    lines.push(`## ${section.title}`, '');
    for (const bullet of bullets) lines.push(renderBulletLine(bullet, linkBase));
    lines.push('');
  }
  if (!any) lines.push('No changes listed.', '');
  lines.push(
    '---',
    '',
    renderFooter(doc.counts),
    '',
    'Each bullet is traceable to the cited commit messages and paths; this does not prove the commit text is true.',
    `Bullets marked ${ATTESTED_MARKER} were restored by a person after the validator dropped them.`,
    '',
  );
  return lines.join('\n');
}
