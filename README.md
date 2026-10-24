# release-notes-from-git

A release-notes generator in which every bullet must cite commits and is checked in code before export. A bullet
whose cited commits do not exist, are outside the range, were reverted, or do not contain what it claims is
dropped with a reason code. A person reviews kept, dropped and uncovered items and approves the export.

The claim is **traceability, not truth**: an exported bullet is traceable to the cited commit messages and paths;
the app cannot prove a commit message is true.

## Status: milestone M1 of 6, source only

**Nothing in this repository has been installed, type-checked, linted, tested, built or run.** It is being written
under static-only construction rules; the checks that were skipped are listed with exact commands in
[`docs/DEFERRED-VALIDATION.md`](docs/DEFERRED-VALIDATION.md). There are no results and no numbers.

What exists as source now:

- Project scaffold and configs (`package.json` with exact versions, no lockfile yet; TypeScript, Vite, Vitest,
  ESLint configs).
- Shared core used by browser and edge function (`supabase/functions/_shared/core/`): limits, the persisted unit
  shape with the prompt-size rule, the model output schema validator, the provider interface, SHA-256 and
  canonical JSON.
- `gitlog.v1.json` parsing with file- and record-level limits and author/email/trailer redaction
  (`src/core/gitlog/`).
- Export core (`src/core/export/`): Markdown escaping, Markdown and JSON exporters, approval hash, and the export
  gate that re-runs an injected validator.
- Shared types for reason codes, verdicts, rulings and review state, and the ruling key.
- Unit tests for parse, redaction, Markdown export and approval (written, not run).

Not yet written: fact table and change units, the validator, fixtures, mock recordings, the UI, database
migrations, the edge function, the evaluation scripts and the Bolt handoff.

## License

MIT, see [LICENSE](LICENSE).
