# Gold attribution

No repository has been qualified or collected. Qualified ranges: **0**; repositories: **0**.
Gold target unmet: 0 ranges / 0 repos. The target remains 20 ranges from at least 8 repositories.
Freeze date: pending. Repository split seed: 2901. All measurements: **not yet measured**.

Only public MIT, Apache-2.0, BSD-2-Clause or BSD-3-Clause data may qualify. Review handwritten release notes
that cite PR numbers. Exclude mechanically generated commit-message notes (including conventional-changelog
and changelogithub style output). Human-written changesets later collated by a bot may qualify after a
documented provenance review. GitHub metadata alone cannot establish handwritten authorship.

For every candidate record inclusion/exclusion and its reason, repository, from/to refs, license and license
URL, release-note URL, notes provenance, retrieval date and entry-to-PR mapping. The builder writes screened
metadata into manifest/attribution and sanitized, hash-pinned local artifacts. It splits by repository with the
recorded seed; all ranges of a repository belong to one split. Dev cannot load held-out artifacts.

`scripts/build-gold.ts --candidates <local-json> --freeze YYYY-MM-DD` accepts a `gold-candidates.v1` object
with a `candidates` array matching its exported `Candidate` type. `gitlog` points to a trusted local export
inside this product repository; `repo_label`, refs and reviewed repository must agree. Optional
`--verify-github` verifies public metadata and PR presence; `GITHUB_TOKEN` is optional and builder-only.
No private repository or author data may be retained. No token is stored in artifacts.

A short collection is explicitly flagged as partial evidence; it never silently changes the fixed target.
The initial construction has made no network requests and has not run this builder or any evaluation.
