# AGENTS.md (product repo rules)

Rules for any agent or person changing this repository.

## Construction notice

This repository is being built under **Dirty Mode** (static-only construction, enabled by Roy for this project on
2026-10-24). Source is written and statically inspected only: nothing has been installed, type-checked, linted,
tested, built or run. Every skipped check is listed in `docs/DEFERRED-VALIDATION.md` with the exact command to run
at activation. Do not describe any feature as working until its deferred checks have passed.

## Data rules

- Synthetic or permissively licensed (MIT, Apache-2.0, BSD) data only. No private repository data, ever.
- No author data: no author, committer, name or email field in any type, fixture, migration, recording or export.
  The parser removes author fields, name-carrying trailers (`*-by:`, `Cc:`) and email-like strings from every
  retained string; fixtures must not rely on that and should be authored authors-free.
- Gold data (later milestones) records repo, tags, licence and retrieval date in `gold/ATTRIBUTION.md`.
- Never commit secrets. `.env.example` holds exactly `VITE_SUPABASE_URL=` and `VITE_SUPABASE_ANON_KEY=`; server
  secrets are never `VITE_`-prefixed and never appear in browser code.

## Repository contents

Product code, tests, fixtures, config and product docs only. Plans, transcripts, agent notes and scratch files
live outside this repository.

## Code rules

- TypeScript with erasable syntax only (no `enum`, `namespace`, parameter properties); `import type` for types.
- Relative imports use explicit `.ts`/`.tsx` specifiers.
- `supabase/functions/_shared/core/` is the single source for code both the browser and the edge function need.
  It uses Web APIs only (no `node:` imports, no DOM). Never copy it elsewhere.
- `src/core/` holds pure browser-side logic; it and `scripts/` import the shared core by **relative path**
  (Node's native type stripping does not resolve aliases). The `@shared` alias is for `src/ui`, `src/data`,
  `src/services` and `src/lib` only.
- Small pure modules, no dependencies beyond `package.json`, exact pinned versions.
- Commit-derived text is untrusted data: never executed, never rendered as markup (`dangerouslySetInnerHTML` is
  forbidden), never used to build links. Links are generated only from validated shas and an `https` base_url.
- The product claim is traceability, not truth: every exported bullet is traceable to commit messages and paths.
  Do not word UI, docs or results as if the app verifies that commits are true.
- Numbers in README come only from `docs/results.md`, which only `scripts/eval.ts` writes.
