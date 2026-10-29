# Deferred validation

**Every check below is pending.** No dependency install, typecheck, lint, test runner, application, browser,
Git exporter, SQL, auth flow, model call, deployment or build has run. Source-only Dirty Mode prevented execution.
Earlier milestones used syntax-only TypeScript parsing, JSON parsing and source/import/name inspection; these
are not typechecking, passing assertions, runtime evidence or release acceptance.

Run from the product Git root in the order below only after the applicable activation is authorized. Resolve a
failure before dependent checks; record the revision, tool versions, command, result and durable non-secret
receipt. Do not repeat a passed check without a source/config/environment change or unresolved concern.
[BOLT-HANDOFF.md](../BOLT-HANDOFF.md) is the **single** target/resource/settings/auth inventory and contains all
spec acceptance rows. This file owns validation order, not a second provisioning inventory. Inspection-only
Bolt import does not authorize the infrastructure or paid steps below.

## Local dependencies and deterministic behavior

1. **Resolve packages and establish the lockfile.** Confirm Node satisfies `package.json` (`node --version`,
   `npm --version`), then run `npm install` and `npm ls --depth=0`. Versions were pinned without registry
   resolution. If an exact version is unavailable/incompatible, make a reviewed exact-version correction and
   record it; do not quietly accept a range or pretend the original pin resolved. Validate the changed tree,
   commit `package-lock.json`, and use `npm ci` for subsequent clean installations. No lockfile exists now.
2. **Type, lint and authored assertions.** Run `npm run typecheck`, `npm run lint`, `npm test`, then
   `npm run build` (intended output `dist/`). The test run must include `tests/unit/`, `tests/ui/`,
   `tests/contract/` and `tests/static/`. `tests/static/env-names.test.ts` now has its M6 handoff input; the
   assertion has still never executed. TSX rendering, dependency compatibility and aliases are unverified.
   The browser/data/service/lib `@shared` alias and relative `.ts` imports from core/scripts must resolve;
   WebCrypto must work. A syntax-only parse does not establish any of this.
3. **Inspect deterministic test coverage and failures.** Resolve failures in parser/redaction/export,
   `gitfacts.*`, `support.literals`, `validate`, `rulings.replay`, `model-output`, `baselines`,
   `m1-followups` and `prompt.mock` tests before accepting the keyless path. Check all named traps in
   `fixtures/gitlog/traps.json`, canonical reason labels/evidence, rejected-record citation provenance, zero
   content tokens, single-digit literals, PR versus issue grouping, topological reverts, explicit cherry picks,
   empty input, 400/401 units, 40/41 units per chunk, 60000/60001 code-point prompt chars and the limits mirror.
   Confirm unsupported fields and author-like stored columns remain absent. Verify independent verdicts with
   and without the injection sentence; no validator branch may classify instruction-like prose.
4. **Verify exact replay parity.** Inspect `tests/unit/prompt.mock.test.ts` results, compare actual facts/units/
   `buildPrompt` output against each indexed `.prompt.txt` snapshot and its UTF-8 hash in
   `fixtures/recorded/INDEX.json`. These snapshots were prepared outside the application by static JSON
   serialization; the actual pipeline has never run. There is no fixture-name/chunk fallback. A mismatch is
   `replay_miss`, never an empty success. Legacy named recordings outside INDEX are not selected.
5. **Exercise Git framing on trusted synthetic history.** Inspect `tests/unit/export-git-log.test.ts`, then in
   a trusted checkout run `node scripts/export-git-log.ts --repo . --from HEAD --to HEAD` for an empty range.
   In a trusted synthetic repository with binary and rename commits, run
   `node scripts/export-git-log.ts --repo <trusted-path> --from <known-tag> --to <known-tag> --outside 5 --out <output-file>`.
   Confirm NUL framing, binary counts as null, renamed destination paths, optional outside SHAs, no author
   fields/trailers/emails, safe argv ordering and visible failure for invalid refs. Git decides ref validity
   beyond the conservative regex. Do not use private data or fetch from the app.
6. **Run keyless synthetic evaluation.** With no API keys or network access, run
   `node scripts/eval.ts --split synthetic --seed 2901`. It writes `docs/results.md` and
   `docs/results-synthetic.md`; inspect per-operator eligible/attempted/skipped denominators, catches/reason
   accuracy, every named false drop/miss, typed/untyped recall and real rule-based/section-gate rows. Missing
   exact recordings leave model rows `not yet measured`, never partial-release success. Inspect
   `tests/unit/eval.*.test.ts` and `tests/static/eval-keyless-boundary.test.ts` results: tiny denominators,
   zero denominators, prefix/OR recall, separate partial audit labels, seeded preconditions, split isolation,
   recorder gating and heldout marker behavior. Unit tests use isolated markers/in-memory artifact I/O and
   must not consume the product heldout set. Mock zero cost is not a live cost estimate.

## Browser demo and export

7. **Register a port before starting a server.** Use the canonical agent-ports skill to claim/check a local
   port, then run `npm run dev -- --host 127.0.0.1 --port <claimed-port> --strictPort`. Open
   `http://127.0.0.1:<claimed-port>/?demo=1`. Complete the README's Synthetic traps journey: parse report,
   omitted `t_huge_body`, acknowledgement, Internal units/noise/reverts/mock ledger, generation, all review
   tabs, edit/remove/literal-add, reasoned `low_support` restore and hard phantom refusal. The authored UI and
   seam tests have never rendered or dispatched a real event.
8. **Check keyboard/layout/accessibility and mode boundaries.** Exercise Tab, arrows, Home/End, j/k, 1-4,
   e/r/x/a/Shift+A/d/?; typing in input/textarea/select/contenteditable must not trigger shortcuts. Verify
   labelled buttons, selected tab/row, dialog focus trapping/inert behavior and focus restoration in a real
   browser (jsdom stubs cannot prove it). Inspect at 375px, 768px and 1440px, zoom and reduced motion. Inspect
   `?demo=0` with no/partial public config: setup; with both values: auth view and uploads disabled until login.
   Explicit demo must import no Supabase runtime, touch no auth storage/client and make no Supabase/provider
   request, even when configured. Alter an uploaded fixture and generate: explicit replay miss plus failed mock
   ledger, no live fallback or fabricated success. Confirm a demo refresh clears in-memory review.
9. **Verify approval at the download boundary.** Controls remain disabled until current content approval.
   Change version, date, base URL and each review action; approval must invalidate immediately, including a
   no-op/category-only edit. Delay async hash/approval/export work and change input mid-flight; stale drafts
   must not download. Check hard reasons cannot be restored and soft restore needs active citations + reason.
   Inspect `release-notes.md`, `release-notes.json`, `dropped.json`: full SHA provenance, fixed section order,
   Security under Fixes with label, HTTPS-only code-generated links, visible `human_attested`, six distinct
   footer counts and dropped reason/evidence/dispositions. Superseded kept edits belong to the approval payload,
   not the dropped list. Confirm Blob/URL lifecycle and repeated downloads in the browser.
10. **Verify actual Markdown rendering.** Render hostile escaping cases from
    `tests/unit/export.markdown.test.ts` in a local CommonMark+GFM renderer and the intended eventual consumer.
    Confirm no commit text becomes headings, links/images, HTML, autolinks, fences, emphasis, table or math.
    Do not post a release as a rendering test. Check invalid calendar dates and metadata in the browser too.

## Target inspection, edge, SQL and auth (later authorized activation)

11. **Inspect before any provisioning.** Use the first prompt in BOLT-HANDOFF. Verify actual provider capability,
    connection identity, baseline/migration history, function runtime/import support and auth/key model through
    authorized read-only access. Prepare a reviewed plan. Do not infer history from tables, replace a populated
    connection or automatically repair its ledger. Only a later authorized provisioning run may continue below.
12. **Resolve/check the edge separately.** Run `deno check supabase/functions/generate-notes/index.ts` in the
    Deno dependency context; the pinned npm import has never been fetched. In an authorized disposable target,
    deploy `generate-notes` with the handoff's JWT configuration and confirm `_shared/core/` relative imports
    are bundled. If the platform excludes shared files, reconcile the single canonical module location and
    both import paths; never duplicate logic or introduce browser aliases into Deno. Confirm gateway checks
    for the actual key model while retaining handler `auth.getUser` identity verification.
13. **Apply only pending migrations and inspect ACLs.** In the authorized disposable target use its supported
    migration runner in handoff order. If an explicitly linked, compatible Supabase test project is selected,
    inspect `supabase migration list --linked`, then `supabase db push --linked` for pending files only; these
    commands are not proof of Bolt support. Inspect `pg_policies`, `information_schema.role_column_grants`,
    `pg_proc` security/search_path/ACL and trigger definitions. Unknown/time-out outcomes require read-only
    verification before retry. Privileged inspection bypasses RLS and cannot establish client isolation.
14. **Use actual anon/user/service clients for boundary tests.** With users A/B confirm B cannot read or mutate
    A's runs, units, snapshots, rulings, requests, calls or allowance. Confirm owned-draft-only unit inserts,
    protected run updates refused, post-seal mutations refused, snapshot/ruling UPDATE/DELETE refused and actor
    forced to JWT user. Anonymous/missing JWT and anon-key bearer generation fail; client reserve/settle calls
    fail and only service role can invoke them after owned-run authorization. Verify foreign run is 404,
    invalid input/chunk/acknowledgement is 400, and browser preflight/allowed/disallowed origins behave exactly
    as inventoried. Inspect `tests/contract/` and SQL/env static test results alongside real effects.
15. **Exercise seal parity and races.** In the disposable DB test 400/401 units, 40/41 per chunk, exactly
    60000/60001 prompt chars including astral Unicode, missing/descending/skipped chunk indices, invalid ordinal
    and SHA, email-like text in every stored string, omitted records/units without acknowledgement, draft text
    changes affecting revision, and simultaneous insert/seal. An insert must commit before sealing includes it
    or be refused after seal; never a silently changed sealed unit set. Compare SQL `left`/`char_length` with
    JS code-point excerpt/count semantics and stable unit ordering/hash.
16. **Verify auth and persistence in an authorized browser.** Configure the handoff's email provider,
    confirmation, Site URL, exact confirmation/recovery redirect and CORS origins. Exercise signup/email
    confirmation, login, session refresh, logout, recovery email and password update. Owner changes clear
    review. Create/generate an owned run, refresh saved runs, select it, then re-upload the identical original:
    sanitized-input/config/unit hashes must match before replay/export. A different upload or configuration
    refuses. Inspect full `initial_review`, `request_drops`, `violations`, complete successive/category-only
    rulings, stored metadata, approval and ledger. Preserve every RequestDrop field and request-boundary lineage
    through save/load, text-only edits, repair and export. Original aggregate units alone are not commit evidence.
    Verify idempotent event retry, event timestamp ordering past restored history, orphan display, earlier
    approval invalidation and later valid approval. Owner snapshots/approvals remain records, not attestations.

## Live enablement and accounting (requires explicit bounded authorization)

17. **Establish the token/price/model premise before a call.** Consult official provider/model/tokenizer
    documentation for the exact immutable model, request fields, usage fields and billed overhead. Verify that
    full serialized HTTP request UTF-8 bytes bound all billed input tokens, including provider-added overhead.
    If this cannot be established, keep live disabled until conservative accounting or an accounted token-count
    endpoint replaces the premise. Check adapter `max_tokens = 4096`, output limit, absence/accounting of caching
    and tool overhead. Select official dated prices, update `config/prices.json`, then prepare the exact JSON as
    server `MODEL_PRICES_JSON` with no duplicate price table. Compare deployed model/rates/date/file parity.
    Missing/unknown/undated/mismatched prices or missing key/model must return 503 with no reservation/call.
    Use only the handoff's names and settings surfaces; never log values or put secrets in VITE configuration.
18. **Exercise atomic caps and exactly-once settlement.** First use fake provider dependencies/disposable SQL
    and then only specifically authorized bounded live calls. Create an operator-approved tiny aggregate owner
    allowance through the server path. Missing allowance is 403; run and owner `spent + reserved + bound` each
    refuse 402 before provider I/O. Reserve concurrently on one run and across two runs of the same owner;
    settle the same attempt concurrently twice. Inspect runs, allowance, calls and requests: one charge and
    reservation release only, repeated settle returns first stored result, at most two attempts/request and
    twice chunk count/run. Completed requests return stored output without another call. Test timeout,
    HTTP/network/malformed output, 1 MiB response limit and known/unknown usage; 502/503/504 must not be mock
    success. Reconcile billed cost against reservation; any breach blocks further activation.
19. **Reconcile interrupted paid requests without replay.** Simulate process loss after reservation and after
    provider completion plus settlement outage. Retry must be 409 pending or failed_unknown, never automatic
    spend. An operator checks provider outcome/billing and uses the authorized service settlement path; unknown
    usage/outcome charges the bound. Verify both run and allowance accounting. Do not auto-expire a reservation
    or auto-reissue an unknown outcome. No worker/job is supplied to repair these cases.
20. **Record only an explicitly authorized live chunk.** After step 17, supply the builder-only opt-in and
    provider/model names from the handoff through an authorized shell without persisting secret values. Run:
    `node scripts/record-mock.ts --input fixtures/gitlog/synthetic-traps.gitlog.v1.json --fixture synthetic-traps --chunk 0 --max-usd 0.50 --i-am-authorized`.
    BOTH `S29_RECORD_LIVE=1` and the authorization flag are required before live import/I/O; key, model, dated
    local price and explicit cap also gate the call. Inspect model/prompt/config/price/usage/cost/latency
    provenance and the exclusive `fixtures/recorded/live-attempt-<hash>.json` journal. An interrupted/unknown
    outcome must be reconciled with billing before any further action. The local journal is distinct from
    SQL ledger/allowance accounting. Complete each needed chunk only under bounded authorization; replay makes
    no paid call. Exercise the injection range live and record its actual supported-or-dropped outcome in
    LIMITATIONS; it remains **not yet measured** until then.

## Gold, heldout, audit and final receipts

21. **Collect and screen gold without reducing the target.** Prepare an operator-reviewed local
    `gold-candidates.v1` packet under `gold/`, matching exported `Candidate` in `scripts/build-gold.ts`: trusted
    local gitlogs, public status, permissive license/evidence URLs, retrieval dates, handwritten/human-changeset
    provenance and reviewed PR entry maps. Run
    `node scripts/build-gold.ts --candidates gold/candidates.json --freeze YYYY-MM-DD --seed 2901` with the actual
    freeze date. Optional `--verify-github` uses public metadata and the handoff's optional builder-only token;
    it cannot establish handwritten authorship. Inspect every inclusion/exclusion reason and attribution.
    Require 20 ranges across at least 8 repos; a short collection is visibly partial evidence (`gold target
    unmet: N ranges / M repos`), never a silently lowered target. Do not overwrite an already frozen manifest.
22. **Tune dev, freeze, then consume heldout once.** After qualified artifacts/needed recordings exist, run
    `node scripts/eval.ts --split dev --seed 2901`; inspect named false drops/misses and tune only on dev via
    `config/thresholds.json`, recording honest `untuned`/`tuned_on` metadata. Repeat dev only before freeze.
    Run `node scripts/eval.ts --split dev --seed 2901 --freeze-dev` to exclusively write `gold/dev-freeze.json`
    binding exact config/manifest/seed/dev dataset. Then exactly once run
    `node scripts/eval.ts --split heldout --seed 2901 --heldout-once`. The exclusive `gold/heldout-once.json`
    marker is reserved before opening heldout artifacts; a failure still consumes it. Never delete/reset it
    to rerun or tune. Changed config/manifest/seed refuses, and a consumed marker closes dev tuning. Retain
    `docs/results-dev.md` and `docs/results-heldout.md`. Valid dev labels may remain in `gold/audit.json`:
    heldout evaluation does not read that file; heldout audit stays unmeasured until explicit import.
23. **Compare live evidence and import the frozen human audit.** For gold recording use step 20 with each
    range's hash-pinned gitlog, manifest range id as `--fixture` and every required chunk recorded before
    heldout. Raw/gated/section rows use identical recording evidence; charge source-release cost once, not per
    comparator. Inspect paired micro recall, typed/untyped denominators and per-release costs; one split is
    not full-gold cost evidence. Inspect `gold/audit-sample-<split>.json`: each seeded case freezes exact ID,
    bullet/category/cites/disposition, source repository/range/fingerprint/index, citation resolutions and
    sanitized cited subject/body/paths plus active/revert context. Roy labels support against that evidence,
    not truth. Dev may use matching dev labels. After heldout completes, put the heldout sample's exact
    dataset/config and 60 IDs in `gold/audit.json` as
    `{schema:"audit.v1",dataset,config,labels:[{id,label}]}` with `supported`, `partial` or `unsupported`, then run
    `node scripts/eval.ts --split heldout --audit-only`. It must reject wrong lineage/IDs and verify completed
    report/sample hashes without reopening heldout or rerunning metrics; preserve valid dev labels until this
    explicit replacement. Partial labels stay separate. Fewer than 60 live bullets/labels stays `not yet
    measured`. Jev and paid self-review stay **not built, unmeasured** and unmeasured respectively.
24. **Close with real receipts, not inferred readiness.** Reconcile BOLT-HANDOFF's spec acceptance rows against
    actual commands, target, revision, deployed resources, auth/isolation/round-trip/missing-setting observations
    and remaining blockers. Inspect final chosen origin/auth redirects if hosting is later prepared. Publishing
    requires its own authorization; it is not part of the initial inspection-only prompt. Copy README result
    claims only from evaluator-written `docs/results.md`, name measured failures in LIMITATIONS and retain the
    source-only status for anything not executed. No row above is closed by current static construction.
