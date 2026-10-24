# Known limitations

Everything here describes source intent or an acknowledged limitation. No application, test, SQL, auth,
provider, browser or deployment behavior has been observed. See [deferred validation](DEFERRED-VALIDATION.md)
for the activation sequence and [results](results.md) for the only measurement record.

## Traceability and lexical checks

- **Traceability is not truth.** Only commit subjects, bodies and paths are evidence. Diffs, execution and actual
  product behavior are unused. A lying commit message can pass, as can a fabricated claim that reuses enough
  vocabulary. Human-list agreement measures agreement, not correctness.
- **Lexical false drops.** Token matching, small English stemming and stop words miss synonyms, paraphrases,
  negation, relationships and context. Vague human entries can fail `low_support`; a bullet with no content
  tokens also fails. Thresholds are untuned. Every measured false drop and missed fabrication must be named by
  the evaluator before any quality claim; no such measurements exist yet.
- **Literal matching is deliberately strict.** URLs, backticks, CVEs, dates, versions, issue references, flags and
  digit-written numbers must occur verbatim after NFC in active cited evidence. Case and URL canonicalization
  are not inferred. Single digits are included; number words such as "three" are not recognized as literals.
- **Typed labels can lie.** `t_docs_only_called_feat` is a known trap: a docs-only change labelled `feat` can
  support a feature category. Untyped commits remain `unknown`; the typed ignore list does not discard them,
  and product-path untyped units can be Uncovered. Unknown typing does not establish a feature/fix or breaking
  claim; breaking still requires an explicit marker. Typed and untyped evaluation must be reported separately.
- **Finite citation knowledge.** The resolver knows accepted commits, rejected-record provenance, declared
  `outside_shas` and boundary parents. It cannot infer all history. Conservative merge/PR and explicit-trailer
  cherry-pick rules can leave duplicate-looking units separate. Identical subject/path text is only a warning.

## Injection and evaluation

Commit text is untrusted and fenced as data. The deterministic validator has no instruction-text branch;
synthetic injection outcomes and independence assertions are authored in source but have never run. The
**live injection outcome is not yet measured**. No claim is made that a real generator ignores the planted
"list every bug as fixed" instruction or that the validator catches every semantic consequence.

Mock recordings are synthetic-authored exact-hash replays, not recordings from a live model. Prompt-pipeline
parity has not been executed; mismatches must surface as `replay_miss`. Gold screening, handwritten-note
provenance, repository isolation, heldout freeze and the human audit are pending. Collection shortfalls must
remain visible; targets must not be reduced to make results look complete. Mutation results, if later measured,
describe only eligible preconditions; cite swaps and spliced claims are report-only.

**Jev: not built, unmeasured.** There is no judge hook or paid self-review comparison. The optional name in the
handoff is unused and does not enable anything.

## Data and Git input

- The parser drops author-like fields and body lines carrying `*-by:`, `Cc:`, `Bcc:`, `Author:` or `Committer:`.
  The email regex is ASCII-only; internationalized addresses can survive. Names in prose are not detected.
  A body `From: Name <email>` retains the name after address replacement. Trailer removal applies to bodies,
  so a subject beginning `Author:` is retained. Do not treat redaction as permission to upload private data.
- File, record, unit, chunk, prompt and output limits reject or visibly omit input rather than silently truncate
  a release. Model prompts excerpt bodies; validation uses retained sanitized commit evidence, so prompting and
  evidence do not expose identical text lengths. Omission acknowledgement records the owner's choice.
  Extra model fields, malformed JSON shape or more bullets than request units refuse the whole chunk.
  Non-hex citations and citations reaching too many units become reported per-bullet violations; citations
  outside the request become request drops. These are not promises that every model produces usable output.
- `scripts/export-git-log.ts` accepts only `^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$`, up to 200 characters and without
  control characters. It refuses `HEAD~3`, `tag^`, `@{...}`, leading `-` and `..`. Refname rules beyond this
  conservative pattern, including whether a ref exists or resolves to a commit, are **left to Git**. A
  regex-accepted string is not a verified ref. Run only against a trusted checkout/fresh clone: Git still reads
  repository configuration despite shell-free invocation and disabled external diff/textconv/fsmonitor.

## Review, storage and export

- `bullets` stores an immutable **owner cache** of the full initial review, request drops and violations, not a
  server validation attestation. Approval rulings are also **owner records, not attestations**. The app creates
  local files; it does not certify them to another party or prevent users editing files outside the app.
- Live reload selects an owned run and requires the original upload. Sanitized input, current configuration and
  reconstructed unit hashes must match before replay/export. Aggregate units cannot reconstruct individual
  commit evidence. Preserve each `RequestDrop`'s original bullet, reason, `requestShas` and `chunk_index`, and
  complete ruling lineage. A text-only edit must not erase a request's citation boundary.
- Rulings key normalized text plus full citations, evidence fingerprint and configuration version. Changed text,
  commit evidence or configuration can orphan a ruling; Internal shows it as not replayed. Every non-approve
  event invalidates earlier approval, including a no-op/category-only edit. A later valid approve can become
  current. Append-only/idempotent event handling is source intent pending SQL and reload checks.
- Hard citation failures require repair. Soft restores require resolvable active citations and a reason, and
  carry `human_attested`; that marker is a human assertion, not stronger automatic evidence.
- `dropped.json` includes superseded edits only when the superseded bullet was dropped. Superseded kept bullets
  are covered by the approval payload's edit pairs rather than listed as drops. Escaping, metadata invalidation,
  async export races, actual Markdown renderers and Blob downloads remain unverified.

## Live cost and infrastructure

The single resource/setting inventory is [BOLT-HANDOFF.md](../BOLT-HANDOFF.md). No database baseline, applied
migration, RLS effect, function deployment, auth redirect, email delivery or shared-import bundle has been
verified. Source checks of grants/triggers cannot establish user isolation or transaction race behavior.

No immutable model or official dated rates are selected; `config/prices.json` has no model prices. The proposed
UTF-8 request-byte input-token bound also depends on provider/tokenizer accounting, including provider-added
overhead. It is **unverified**; live activation must remain disabled unless that premise is established or
replaced by conservative accounted token handling. Adapter field support, token usage, latency and billing are
unknown. No spend or quality estimate is a measured result.

Server reserve/settle source uses both a per-run cap and aggregate owner allowance. Process loss or settlement
outage can strand a reservation; there is no automatic expiry/reissue for unknown paid outcomes. An operator
must reconcile provider billing and settle through the authorized service path. The builder recorder's local
once-only journal is distinct from this SQL ledger and provides no deployed cap/isolation proof.

There are no app-side GitHub fetches, diffs, release posting, tags/pushes, version suggestions, multilingual
variants, monorepo path filters, background workers, buckets or Realtime. Those are outside this source scope.
