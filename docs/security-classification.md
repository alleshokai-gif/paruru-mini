# Security classification

| Classification | Examples | Phase 0 handling |
| --- | --- | --- |
| Green | General weather, non-personal public display data | Public read only after a data-minimization review |
| Yellow | Existing Growth Dashboard, Looker and Signage display data | Keep the existing application unchanged; any public-API hardening is a future separate project |
| Red | Health records, PALURU Inbox, device pairing, write APIs, Calendar writes, Signage alert writes | Authentication, authorization, allowlists, idempotency, fail-closed errors, and no secrets in browser code or logs |

The existing Growth Dashboard remains unchanged. Its public-API safety review and remediation are future work in a separate project. Nurse Okan MVP does not use the Growth API. All Health APIs and Home Membership data are Red.

URLs are not credentials. Tokens, Script IDs, Spreadsheet IDs, pairing tokens, and internal service endpoints must not be included in browser JavaScript, logs, test fixtures, or documentation examples.
