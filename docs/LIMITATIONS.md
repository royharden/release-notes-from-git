# Known limitations

Honest limits of the redaction and export rules. Each is a known gap, not a bug to be silently worked around.

## Redaction (`src/core/gitlog/redact.ts`)

- **ASCII-only email pattern.** The email pattern matches ASCII local parts and domains only. Internationalised
  addresses (non-ASCII local part or IDN domain written in Unicode) pass through unredacted.
- **`From: Name <email>` keeps the name.** `From:` is not a named trailer, so the line is kept; the address is
  replaced by `[email removed]` but the name before it survives.
- **Names in prose are not detected.** Author fields and name-carrying trailers (`*-by:`, `Cc:`, `Bcc:`,
  `Author:`, `Committer:`) are removed from bodies, but a name written in ordinary text ("thanks to Jane for
  the fix") cannot be recognised and is retained.
- **Trailer stripping applies to bodies only.** A subject line is email-redacted but never dropped, so a
  subject that starts with `Author:` is kept as written.

## Export (`src/core/export/`)

- **`dropped.json` lists only edits of dropped bullets.** An edited bullet appears there only when its
  superseded version was not kept. Edits of kept bullets are not listed; they are covered by the approval hash,
  whose payload records every `from -> to` edit pair.
