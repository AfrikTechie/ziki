# Public issue intake

Public issue intake lets a project accept useful bug reports from people who do not have a Ziki account. It is disabled by default and can be enabled only for a public project in Project settings.

The existing public project overview lives at `/<org>/<project>`. When intake is enabled it links to `/<org>/<project>/report`. A successful submission creates a normal product idea with `source: "public"` and returns an unguessable `/<org>/<project>/track/<token>` URL. Only the SHA-256 hash of that token is stored. Tracking pages are `noindex` and continue to work if intake is later disabled, while the project remains public.

Guest reports enter the private idea triage queue. They are not listed on signed-out pages and guests cannot vote, bid, claim, review, merge, or upload files. Duplicate suggestions expose only an item type, number, title and status; they do not link to internal item pages.

The form uses same-public-host origin validation, body and field limits, a honeypot, duplicate checks, per-client and per-project rate limits, and idempotent tracking tokens. Rich-text rendering remains responsible for blocking unsafe links, so reports may describe strings such as `data:` or `javascript:` as ordinary text.

Each project has a synthetic, non-login reporter identity so existing required relations remain intact. Public-source ideas never award reporter points to that identity and conversion does not subscribe it as an issue watcher. Agents receive `source` on idea API responses so they can distinguish public intake from member and agent submissions.
