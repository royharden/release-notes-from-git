# Local reusable concepts and provenance

No third-party source code was copied or vendored. The names below describe locally authored minimal concepts;
they are not installed workspace packages, complete upstream libraries or compatibility claims. This repository's
license is [MIT](LICENSE); external reading does not change its provenance.

| Concept | Actual local implementation | Boundary |
|---|---|---|
| `cited` | `src/core/cited/pointer.ts`, `src/core/cited/resolve.ts` | Concept owner **S5**. S29 owns its Git-specific resolver: exact/prefix citations, ambiguity, rejected records, outside SHAs and boundary parents. No S5 code was copied. |
| `evalkit` | `scripts/eval.ts`, `scripts/mutate.ts`; `tests/unit/eval.*.test.ts` | Local seeded metrics/splits/audit/recording checks. There is no `evalkit/` package. S29 owns its mutation operators and release-specific evaluation. |
| `callledger` | `supabase/functions/_shared/core/cost.ts`, `supabase/functions/generate-notes/handler.ts`, `supabase/migrations/20261101000400_budget_and_ledger.sql`, `src/data/repo.ts`, `src/data/supabase-repo.ts` | Local reservation/settlement and ledger shapes. The builder-only journal in `scripts/record-mock.ts` is separate; no `callledger/` package exists. |
| `providers` | `supabase/functions/_shared/core/providers/{types,mock,http,anthropic,openai-compatible}.ts` | Local provider contracts, exact replay and bounded HTTP adapters; no external provider source copied. Configuration/deployment remain pending. |
| `rulings` | `src/core/rulings/{types,key,fingerprint,replay}.ts`; `supabase/migrations/20261101000300_seal_and_rulings.sql` | Local event identity, evidence/config replay and append-only SQL source. Owner approval is not an attestation. |

S29-specific logic lives in `src/core/gitfacts/`, `src/core/support/`, `src/core/validate/`,
`src/core/baseline/` and `scripts/mutate.ts`; it is not attributed to a generic reused library. Shared runtime
code has a single source in `supabase/functions/_shared/core/`; browser aliases do not create a second copy.

Prior-art ideas include section-level gates (misty-step/landmark), explicit skipped/uncertain review
(github/copilot-release-notes), revert net-state handling (nosovj/llm-release-action), and commit/PR context
(git-cliff). These are conceptual influences only. No external datasets have been imported. Reading-only
datasets with uncertain or incompatible licensing must not be silently added; future gold material needs the
screening and attribution documented in `gold/ATTRIBUTION.md` and [deferred validation](docs/DEFERRED-VALIDATION.md).
