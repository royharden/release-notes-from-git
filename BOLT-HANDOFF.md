# Bolt infrastructure handoff: Release notes from git

## First prompt: inspect and prepare only

> Read BOLT-HANDOFF.md and inspect the imported product repository at the owner-selected branch/revision.
> The intended fresh target is **Bolt Database**, but no actual connection or migration baseline is verified.
> Compare this inventory with source; when authorized read-only access exists, inspect migration history,
> schema, grants, auth and function settings and report drift. Prepare a concrete setup plan and remaining
> owner/external blockers. Preserve the app and any existing connection/data. **Do not create/change cloud
> resources, apply migrations, deploy functions, enter secrets, enable schedules or publish.** Source has never
> been installed, typechecked, linted, tested, built or run. Do not describe pending checks as complete or replace
> live integrations with mock success. A later provisioning run requires its own authorized, reviewed plan.

## Target and readiness

- Product repository/app root: `release-notes-from-git/` inside the outer coordination shell; import this inner
  Git root only. Branch: `main`. Prepared revision: the owner's selected M6 commit (record exact hash at import).
  Local Git only; no remote or GitHub import exists. GitHub publication/import is a future owner action.
- Database: **Bolt Database**, intended fresh empty target. Do not provision a separate Supabase project first
  or replace any connection discovered later. Supabase-compatible source does not prove Bolt supports/deploys
  every resource here; inspect actual target/runtime/key compatibility before activation.
- Actual database baseline/applied migrations: **unknown; unapplied by this construction run**. None of the
  migration files has been executed. File presence is not schema or migration-ledger evidence.
- Hosting: intended Bolt hosting, not configured. Publication: **prepare only; no publishing authorized here**.
- Bolt action: **inspect and prepare only**. Source-present, runtime-unverified; **not locally ready**.
  Infrastructure/provisioning, package resolution and all release acceptance remain pending.
- Owner prerequisites: selected GitHub destination/revision and access; confirmed Bolt Database target and
  provider capability; auth origin/email delivery; explicit live permission/caps; provider account/key,
  immutable model and official dated rates; verified token-accounting premise. No credentials were inspected.

## Build and connection

| Item | Command / source / current outcome |
|---|---|
| Runtime/package manager | Node `>=22.18.0`, npm; exact dependency versions in `package.json`, unresolvable/compatibility risk untested |
| Initial install/frozen install | `npm install`, `npm ls --depth=0`, validate and commit `package-lock.json`; then `npm ci`. No lockfile currently exists; nothing installed |
| Dev | `npm run dev -- --host 127.0.0.1 --port <claimed-port> --strictPort`; claim a port using agent-ports before starting. Never run during current source-only construction |
| Build/output | `npm run build`; intended `dist/`, unbuilt |
| Type/lint/tests | `npm run typecheck`, `npm run lint`, `npm test`; all unrun. Edge separately: `deno check supabase/functions/generate-notes/index.ts`, unrun |
| Browser client/public env | `src/lib/supabase.ts`; exactly `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` in `.env.example`; both public connection settings, never provider/service secrets |
| Missing configuration | No public settings defaults to demo unless `?demo=0`; partial settings/explicit live without both show setup. `?demo=1` explicitly selects offline demo even when configured |
| Detailed activation checks | [docs/DEFERRED-VALIDATION.md](docs/DEFERRED-VALIDATION.md); commands there are instructions, not receipts |

## Database: sole resource inventory

All resources below are implemented **SQL source**, unexecuted. Apply only after baseline inspection in a later
authorized provisioning run, in this order:

| Order | Exact file under `supabase/migrations/` | Resources / dependencies | Applied status |
|---|---|---|---|
| 1 | `20261101000100_core_tables.sql` | `extensions` schema + `pgcrypto`; `runs`, `run_units`, `bullets`, `rulings`; owner defaults, composite parent FKs, status/identity/budget checks | Unknown target; not executed here |
| 2 | `20261101000200_rls_and_grants.sql` | RLS/grants/policies for those four tables; authenticated owner reads, bounded draft writes, sealed snapshot/ruling insert | Same |
| 3 | `20261101000300_seal_and_rulings.sql` | Trigger functions `guard_run_write`, `guard_unit_write`, `reject_mutation`, `bind_ruling_actor`; triggers `runs_guard`, `units_immutable`, `rulings_immutable`, `bullets_immutable`, `rulings_actor`; RPC `seal_run(uuid)` | Same |
| 4 | `20261101000400_budget_and_ledger.sql` | `live_allowances`, `llm_requests`, `llm_calls`; their RLS/read policies; service RPCs `reserve_llm_attempt(uuid,uuid,text,integer,text,text,text,date,numeric)`, `settle_llm_attempt(uuid,bigint,bigint,numeric,integer,text,text,jsonb)` | Same |

- No anon table access. Authenticated clients read only `owner = auth.uid()` rows. Composite `(run_id,owner)`
  foreign keys and parent-status policies bind child mutations to the same owner's draft/sealed run.
- Client run INSERT columns: `repo_label`, `from_ref`, `to_ref`, `input_sha256`, `parse_report`,
  `has_unit_omissions`, `config_version`, `budget_usd`; only `omissions_ack_at` can be updated in draft.
  `guard_run_write` protects server counts/status/hashes/accounting. `run_units` inserts require draft parent;
  `guard_unit_write` serializes against sealing and prevents post-seal changes.
- `bullets` is one immutable owner generation snapshot per run: `initial_review`, `request_drops`, `violations`.
  It is an owner cache, not an attestation. Rulings are append-only `restore|edit|remove|add|approve` events,
  keyed by `client_event_id`; actor is bound to JWT identity. No authenticated UPDATE/DELETE grant for either.
- `seal_run` is SECURITY DEFINER with fixed `search_path`, owner/acknowledgement/limits/email backstop checks,
  counts/chunk validation and a `pgcrypto` revision hash; EXECUTE only for authenticated (revoked PUBLIC/anon).
- `reserve_llm_attempt` and `settle_llm_attempt` are SECURITY DEFINER with fixed `search_path`; EXECUTE revoked
  from PUBLIC/anon/authenticated and granted to `service_role` only. Authenticated owners can read ledger and
  allowance rows, never write them. All seven tables have RLS source. Service access bypasses RLS and must
  occur only after handler identity/ownership proof.
- No seed SQL. Browser fixtures are separate, synthetic files in `fixtures/gitlog/`; no real user data imported.
- Retry rule: inspect migration history and schema/policies/triggers/RPC ACL first, compare with exact files,
  apply only pending changes, and verify uncertain timeout outcomes before retry. Report drift; never repair
  history, replay destructive changes or drop/recreate an existing populated connection to hide a mismatch.

## Edge function

| Name / source | Caller/auth | Contract | Resources/settings | Deploy configuration |
|---|---|---|---|---|
| `generate-notes`; `supabase/functions/generate-notes/index.ts`, `handler.ts` | Signed-in user JWT, verified via `auth.getUser(jwt)`; missing JWT or anon key as bearer refused | POST `{run_id,chunk_index,provider}` where provider is `anthropic` or `openai_compatible`; completed `{request_key,status,bullets,outsideRequest,violations,usage}` or pending/error response | User-scoped `runs`, `run_units`, `llm_requests`; privileged reserve/settle RPCs after ownership proof; server settings below | `supabase/config.toml`: `[functions.generate-notes] verify_jwt = true`; pinned `npm:@supabase/supabase-js@2.49.4`; relative `.ts` imports into `_shared/core/` |

- Confirm gateway JWT/key compatibility in the actual target; gateway checks do not replace handler identity
  checks. Bundle the referenced shared files. Browser alias resolution does not prove Deno/edge bundling.
- CORS: comma-separated exact `ALLOWED_ORIGINS`; allowed origins receive POST/OPTIONS and
  `authorization,apikey,content-type,x-client-info`. OPTIONS is 204. Non-allowed Origin is 403; no-Origin clients
  still need valid user auth. CORS does not authenticate.
- Errors are explicit: 400 invalid input/run/chunk, 401 unauthorized, 402 budget, 403 origin/allowance, 404
  missing/foreign run, 409 pending/retry boundary/unknown outcome, 502 provider failure or `upstream_malformed`,
  503 missing live settings/service, 504 provider timeout. Live errors never become mock success.
- Paid source controls: sealed owned input and acknowledged omissions, request-key cache, atomic run+allowance
  reservation before provider I/O, default run budget $0.50/ceiling $5, at most two attempts/request and twice
  chunk count/run, output `max_tokens = 4096`. Full serialized request UTF-8 byte length drives the proposed
  input-token upper bound. **Tokenizer/provider overhead premise is unverified; live remains blocked.**
- Settlement is intended exactly once in SQL, releasing run and allowance reservation and recording usage,
  dated-price cost and latency. Unknown usage is charged at the bound; unknown paid outcomes never auto-reissue.
  Crashed/in-flight reservations need operator billing reconciliation; no expiry job exists.
- Webhooks: Not required. No public unauthenticated generation endpoint, worker or scheduled function.

## Server settings: names only

Every `Deno.env.get` in `supabase/functions/generate-notes/index.ts` is inventoried here. No server name has a
public prefix. Do not copy another project's values or enter secrets into browser code/chat.

| Name | Consumer | Required / source |
|---|---|---|
| `SUPABASE_URL` | `generate-notes/index.ts`, user/service clients | Platform-injected database endpoint; verify actual target provides it |
| `SUPABASE_ANON_KEY` | Same; user client and bearer-key rejection | Platform-injected public project key, server consumer; verify runtime key compatibility |
| `SUPABASE_SERVICE_ROLE_KEY` | Same; service client inside reserve/settle only | Platform-injected privileged credential; verify availability, never frontend |
| `ALLOWED_ORIGINS` | Same; handler CORS | Owner-supplied comma-separated exact local/final app origins; no wildcard |
| `MODEL_PRICES_JSON` | Same; `readPrices` in shared `cost.ts` | Owner-prepared server configuration from exact `config/prices.json`; leave unset/empty until immutable model and official dated rates are selected |
| `ANTHROPIC_API_KEY` | Same; Anthropic adapter | Owner's provider account; required for chosen core live adapter |
| `GENERATOR_MODEL_ID` | Same; Anthropic request identity | Owner-selected exact immutable model supported by adapter and price table; none selected here |
| `OPENAI_COMPATIBLE_API_KEY` | Same; optional compatible adapter | Optional owner credential only if activating `openai_compatible` |
| `OPENAI_COMPATIBLE_BASE_URL` | Same; optional compatible adapter endpoint | Optional server-only HTTPS base URL, never from browser payload |
| `OPENAI_COMPATIBLE_MODEL_ID` | Same; optional adapter identity | Optional exact immutable model with matching provider prices |
| `TYPESAFE_API_KEY` | **No source consumer** | Unused optional name only; Jev is **not built, unmeasured**. Do not supply for current scope |

`config/prices.json` currently has `models: {}`. Before future live activation, obtain official dated prices
for the exact immutable model, fill its `provider`, `input_usd_per_mtok`, `output_usd_per_mtok`, `as_of`, and
prepare `MODEL_PRICES_JSON` from that exact JSON without a second price table. Verify deployment parity and
the provider/token-accounting premise before entering live settings. Missing key/model/matching dated prices
returns `503 live_not_configured` without reservation or model I/O. Missing owner allowance returns
`403 live_not_allowed`. Server-only operator creation of an allowance is separate from signup.

### Builder-only configuration (never edge/browser settings)

- `GITHUB_TOKEN`: optional for `scripts/build-gold.ts --verify-github`; public metadata checks cannot establish
  handwritten release-note provenance. No app/eval keyless import of the builder.
- `S29_RECORD_LIVE=1`: explicit opt-in for `scripts/record-mock.ts`, **also** requiring `--i-am-authorized`, a
  builder-shell `ANTHROPIC_API_KEY`, `GENERATOR_MODEL_ID`, dated local `config/prices.json` and explicit
  `--max-usd` cap. It reads prices from that local file, not `MODEL_PRICES_JSON`. No call is authorized now.
- The exclusive `fixtures/recorded/live-attempt-<hash>.json` local journal prevents automatic repeat after an
  uncertain recorder outcome. It is **not** `llm_calls` or the deployed SQL reservation/allowance ledger.
  See deferred validation for the bounded command and manual reconciliation rule.

## Auth, storage and external steps

- Auth source: `src/ui/Auth.tsx`, email/password signup, confirmation link, login/logout/session restore,
  recovery link and password update. Enable email/password and confirmation in the eventual target and verify
  email delivery; no OAuth providers required. Account email is auth identity, not imported commit-author data.
- Site URL: exact eventual app origin. Confirmation/recovery redirect is
  `${window.location.origin}${window.location.pathname}?demo=0`; allow that exact local/final origin/path in auth
  redirects. There is no separate callback route. Final origin remains unknown until hosting is chosen; use it
  consistently in auth and CORS. Verify chosen target's email/JWT/runtime behavior rather than assuming it.
- Buckets/object policies: **Not required**. File uploads are browser reads, not object uploads; sanitized
  live units/snapshots are database rows with the owner controls above.
- Realtime/publications/channels: **Not required**. Scheduled/long jobs, workers, cron extensions: **Not required**.
- External services: intended Anthropic live API (unverified), optional compatible API seam (unconfigured);
  keyless demo uses in-memory storage and synthetic-authored mock replay. No GitHub fetching/posting in app.
- Live restoration: select an owned run, then upload the original file. Sanitized-input hash, current config
  hash and reconstructed unit payload hash must all match. Preserve full `RequestDrop` fields (`index`,
  `bullet`, `reason`, `evidence`, `outside`, `requestShas`, `chunk_index`) and complete ruling history through
  persistence/replay/export.
  Aggregate stored units alone never suffice to reconstruct per-commit export evidence. Owner snapshot/approval
  rows are not attestations.

## Acceptance status and receipts

All rows are **source-present / runtime-pending**, not passing tests or release acceptance. Static name
reconciliation supplies no deployed receipt. Execute the detailed ordered checks in
[docs/DEFERRED-VALIDATION.md](docs/DEFERRED-VALIDATION.md), then record actual results against these rows.

| Spec item | Source/evidence location | Status / pending observation |
|---|---|---|
| 1. Type/lint/tests and keyless app | `package.json`, `tests/`, demo mode | Source-present / runtime-pending: install, tsc, ESLint, Vitest, build and offline browser |
| 2. Bounded parsing/redaction | `src/core/gitlog/`, parser/redaction tests | Source-present / runtime-pending: rejects, stored redaction and documented regex limits |
| 3. Grouping/reverts | `src/core/gitfacts/`, fixtures and fact tests | Source-present / runtime-pending: squash/merge/rebase, cancellation/reactivation/outside cases |
| 4. Every reason label/evidence | `src/core/validate/reasons.ts`, `src/ui/reason-labels.ts`, validator/UI tests | Source-present / runtime-pending: canonical reason codes and displayed evidence |
| 5. Hard citation failures blocked at export | `src/core/cited/`, `src/core/export/gate.ts`, approval/validator tests | Source-present / runtime-pending: phantom/ambiguous/outside/missing cite refuses download |
| 6. Mock/live/schema boundary | `_shared/core/providers/`, `_shared/core/output-schema.ts`, handler | Source-present / runtime-pending: exact replay, real adapter and only text/category/cites model fields |
| 7. Approval hash and human marker | `src/core/export/`, `src/ui/ExportPanel.tsx` | Source-present / runtime-pending: current approval required; restored output marked `human_attested` |
| 8. Append-only/replay | `src/core/rulings/`, migration 3, replay tests | Source-present / runtime-pending: evidence/config mismatch orphaning; SQL immutability/actor |
| 9. Evaluation outputs | `scripts/eval.ts`, `scripts/mutate.ts`, `docs/results.md` | Source-present / runtime-pending: metrics/denominators/named failures; all measurements unrun |
| 10. Injection independence/live outcome | Trap fixture, validator/no-instruction-branch tests, `docs/LIMITATIONS.md` | Source-present / runtime-pending: deterministic assertions unrun; live outcome **not yet measured** |
| 11. Ledger/caps/unit chunks | Shared `cost.ts`, handler, migration 4, chunk/contract tests | Source-present / runtime-pending: token bound, budget races/settlement, chunk limits |
| 12. Review actions/escaped exports | `src/ui/review/`, `src/ui/ExportPanel.tsx`, `src/core/export/` | Source-present / runtime-pending: all review actions, fixed sections, HTTPS links and three downloads |
| 13. Gold provenance/keyless boundary | `gold/manifest.json`, `gold/ATTRIBUTION.md`, builder/static test | Source-present / runtime-pending: collection target unmet, screening/splits/freeze unexecuted |
| 14. Names/provisioning agreement | Four migrations, `generate-notes`, `.env.example`, this inventory | Source-present / runtime-pending: names inspected as text; env assertion and all deployment checks unrun |
| 15. Honest results/limitations/Jev | `README.md`, `docs/results.md`, `docs/LIMITATIONS.md` | Source-present / runtime-pending: no measured claims; Jev **not built, unmeasured** |

Import/install/build, schema, function round trip, two-user/anon isolation, missing-secret behavior, auth,
recovery, browser downloads, ledger races and final-domain behavior have **no execution receipts**. Storage,
webhooks and jobs are not required. Publishing is outside this inspection-only handoff. Future provisioning
must report actual resources/results and blockers, not infer success from these source inventories.
