# Deferred validation

This repository is built under static-only construction rules: source is written and inspected, never executed.
Each row is a check that has **not** been run, why, and exactly how to run it at activation. Run the rows in order;
a row is closed only when its command passes on a clean checkout.

Static checks that were run during construction: a syntax-only parse of every `.ts` file (types stripped, parsed,
never executed) and `JSON.parse` of every `.json` file. Neither is a type check.

| # | What | Why deferred | Exact command / steps |
|---|---|---|---|
| 1 | Install dependencies and commit the lockfile | Installs are not allowed during construction; `package.json` pins exact versions but no `package-lock.json` exists | `npm install` (Node >= 22.18), confirm every pinned version resolved as written (`npm ls --depth=0`), then commit `package-lock.json`; afterwards use `npm ci` |
| 2 | Pinned versions exist and are compatible | Versions were chosen from memory, not resolved against the registry | Part of row 1: if a version fails to resolve, pick the nearest published exact version, record it here, and re-run rows 3-6 |
| 3 | Type check | Not run | `npm run typecheck` (runs `tsc -p tsconfig.json` and `tsc -p tsconfig.node.json`) |
| 4 | Lint | Not run | `npm run lint` |
| 5 | Unit and static contract tests | Written, never executed | `npm test` (`vitest run`); M1 plus M2 fixture/facts/chunks/resolver/literals/validator/rulings/prompt/mock/export-script/baseline regressions and `tests/static/` |
| 6 | Production build | Not run; also cannot pass before milestone M3 writes `src/main.tsx` (referenced by `index.html`) | `npm run build` after M3 |
| 7 | `@shared` alias resolution | Alias declared in `tsconfig.json` and `vite.config.ts` (inherited by Vitest) but never resolved by a tool | Covered by rows 3, 5 and 6 once a file under `src/ui`, `src/data`, `src/services` or `src/lib` imports `@shared/...` (M3) |
| 8 | Node scripts run without an alias | `src/core` and `scripts` import the shared core by relative path so Node's native type stripping can run them; untested | `node scripts/eval.ts --split synthetic` after M5; any `ERR_MODULE_NOT_FOUND` for `@shared` means an alias leaked into `src/core` |
| 9 | WebCrypto in every runtime | `hash.ts` uses `crypto.subtle`; assumed global in browsers, Node >= 22 (Vitest node environment) and Deno | Row 5 covers Node; `deno check supabase/functions/generate-notes/index.ts` and a deployed call cover Deno (M4) |
| 10 | Markdown escaping in real renderers | Escaping is asserted on strings only; GFM autolink and math behaviour not observed in a renderer | Render the output of `tests/unit/export.markdown.test.ts` cases with a CommonMark+GFM renderer (e.g. GitHub's Markdown preview of a release body in a private scratch repo, or `npx marked --gfm`) and confirm no heading, link, image, HTML, autolink, emphasis, table or math appears |
| 11 | Date parsing of invalid calendar days | `isCalendarDay` round-trips through `Date`; engines differ (roll-over vs Invalid Date) but both must be refused | Row 5 (`refuses invalid export meta`); also run once in a browser |
| 12 | `config/limits.json` mirrors `LIMITS` | Asserted by a test that has not run | Row 5 (`config/limits.json mirror`) |
| 13 | Edge function access to config | `config/prices.json` sits at the repo root, outside `supabase/functions/`; the function bundle may not include it | Decide in M4 (embed dated prices in the shared core or read from env); verify with a Bolt deploy |
| 14 | M2 deterministic contracts and trap expectations | Test source covers all trap outcomes and reason labels, 400-unit refusal, 40-unit/60,000-code-point chunks, revert order, citation provenance, literal classes, injection independence, global duplicates and ruling identity/restore rules; assertions have never run | After row 1: `npm test -- tests/unit/gitfacts.conventional.test.ts tests/unit/gitfacts.fixtures.test.ts tests/unit/gitfacts.boundaries.test.ts tests/unit/support.literals.test.ts tests/unit/validate.test.ts tests/unit/rulings.replay.test.ts tests/unit/model-output.test.ts tests/unit/baselines.test.ts tests/unit/m1-followups.test.ts tests/static/no-forbidden-fields.test.ts tests/static/validator-no-instruction-branches.test.ts` |
| 15 | Exact-hash mock replay and prompt snapshot parity | Two synthetic-authored outputs are indexed by UTF-8 SHA-256 of adjacent `.prompt.txt` snapshots. Snapshot byte hashes were checked statically; snapshots were prepared by standalone stdlib JSON serialization from fixture data without importing or executing application modules. The actual facts/units/prompt pipeline has never been executed. No fixture/chunk fallback exists; any mismatch is an explicit `replay_miss`. Preserved legacy named recordings are not selected by INDEX.json | `npm test -- tests/unit/prompt.mock.test.ts`. Compare the authored snapshot against `buildPrompt` for each chunk; reconcile any difference before accepting replay. INDEX.json documents field order, framing and hash recipe; provenance remains `synthetic-authored`, never a live-model claim |
| 16 | Git exporter framing and safe invocation on real Git | Only source inspection and authored framing/argv tests; Git exporter has never run. Refs beyond the conservative pattern remain subject to Git's own ref rules | `npm test -- tests/unit/export-git-log.test.ts`, then in a trusted checkout `node scripts/export-git-log.ts --repo . --from HEAD --to HEAD` (empty range). On a trusted synthetic repo with binary/rename commits, repeat with its known tags and `--outside 5`, then upload that output and inspect counts; no network or credentials are needed |

M2 static construction check: 63 `.ts` files (61 source/test/script files plus the two root TypeScript configs)
parsed with the existing syntax-only checker with zero failures; 16 product/config/fixture JSON files parsed.
The two snapshot byte hashes match INDEX.json.
No dependency install, typecheck, lint, test assertion, application execution, Git-export invocation, build or
runtime/prompt-pipeline parity check was performed. These source checks do not close any deferred row.
