# Release notes from git

Draft release notes from a local `gitlog.v1.json` export, inspect each bullet's commit citations and deterministic
checks, review omissions and drops, then approve browser downloads. The claim is **traceability, not truth**:
commit messages and paths can support a statement without proving the underlying change happened or works.
A lying commit message can pass. The app does not read diffs.

## Source-only status

**No dependency install, typecheck, lint, tests, build, application run, SQL execution, auth flow, deployment or
live model call has occurred.** Source and test assertions are present; static inspection does not show that
the app works. There is no lockfile yet. Follow [deferred validation](docs/DEFERRED-VALIDATION.md) in order before
making runtime or release claims. This local repository has no remote and has never been pushed.

All measurements belong in [results.md](docs/results.md), currently **not yet measured**. The fixtures and
recordings are synthetic-authored; they are not evidence of a live model's behavior or cost. Jev is
**not built, unmeasured**.

## What the source contains

- A trusted-checkout Git export script and bounded upload parser with record rejection, omission acknowledgement,
  author-field/trailer stripping and email-pattern redaction.
- Deterministic conventional-commit facts, PR grouping, conservative cherry-pick collapse, graph-ordered revert
  handling, noise accounting and bounded change-unit chunks. Untyped subjects stay `unknown`.
- Per-bullet citation resolution, literal checks, lexical support, category checks and duplicate detection.
  Dropped bullets retain reason labels and evidence. These checks have semantic limits described in
  [LIMITATIONS.md](docs/LIMITATIONS.md).
- Kept, Dropped, Uncovered and Internal review sources; edit, remove, literal-add and reasoned soft-restore
  actions; append-only ruling replay; hard citation failures require citation repair. Restores are visibly
  `human_attested`.
- A content-hash approval and export gate that revalidates at download time. Review or metadata changes clear
  approval. Outputs are `release-notes.md`, `release-notes.json` and `dropped.json`; Markdown uses fixed sections,
  escaped text and code-generated HTTPS commit links.
- An in-memory demo with exact prompt-hash mock replay, plus a separate owner-scoped live repository, email/password
  auth UI, SQL migrations, `generate-notes` edge handler, Anthropic adapter and server-configured
  `openai_compatible` seam. The live adapter and infrastructure are unverified.
- Evaluation, seeded mutations, rule-based and section-gate comparators, gold-collection and authorized recording
  helpers, and human-audit artifacts. Gold is not collected and every result is unmeasured.

Shared browser/function contracts live in `supabase/functions/_shared/core/`; deterministic browser-side logic
lives in `src/core/`. [VENDORED.md](VENDORED.md) describes the locally authored minimal reusable concepts.
[BOLT-HANDOFF.md](BOLT-HANDOFF.md) is the single infrastructure and configuration inventory, beginning with an
inspection-only prompt.

## Commands for future activation

Run from this product repository with Node satisfying `package.json`'s engine requirement. These commands are
instructions, **not completed checks**:

```sh
npm install
npm ls --depth=0
npm run typecheck
npm run lint
npm test
npm run build
```

Resolve exact pinned packages and commit the resulting `package-lock.json` after validation; subsequent clean
installs use `npm ci`. The full ordered sequence, edge/SQL checks and safe local-port setup are in
[deferred validation](docs/DEFERRED-VALIDATION.md). Production output is intended at `dist/`.

To prepare an input later, use only a trusted repository or fresh clone, with synthetic or permissively licensed
public data. The exporter reads the checkout's Git configuration:

```sh
node scripts/export-git-log.ts --repo <trusted-checkout> --from <tag-or-sha> --to <tag-or-sha> --out release.gitlog.v1.json
```

The export script does no fetch, post, tag or push. Ref expressions are deliberately restricted; Git still
decides whether an accepted spelling is a valid, existing ref. Do not upload private repository data.

## Intended keyless demo

After the activation checks and a registered local port, start the dev command recorded in deferred validation
and open `/?demo=1`. With no public configuration the default is also demo; `?demo=0` or partial public
configuration shows setup. Explicit demo selection must avoid the Supabase runtime and all provider calls.

1. Load **Synthetic traps**, or upload a compatible fixture. Inspect rejected records, including `t_huge_body`,
   and redaction counts; acknowledge omissions.
2. Inspect Internal units, noise and cancelled reverts. Generate the authored mock replay; inspect Kept,
   Dropped and Uncovered, including planted bad bullets and mock ledger rows.
3. Edit and remove a bullet, add a literal entry, restore the `low_support` drop with a reason, and confirm the
   phantom citation cannot be restored before repair.
4. Enter version/date, approve, then download the Markdown and both JSON files. Change review content or
   metadata and confirm approval is invalidated.

Only exact indexed prompts replay; arbitrary uploads can be parsed and reviewed but generation without a
matching recording must report `replay_miss`. This journey has never been run.

Live use additionally needs the handoff's auth, migrations, function, operator allowance, model, dated prices
and server settings. Restoring a live run requires an owned run and the original upload with matching sanitized
input, current configuration and unit hashes. Stored generation snapshots and owner approvals are owner
records, not server attestations. Full request-drop lineage must survive save, reload, edits and export.

## License

MIT; see [LICENSE](LICENSE).
