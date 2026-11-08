# Privacy by design (GDPR)

The Hub stores personal data of applicants (CVs, motivation, assessments) and of client contacts. These are the measures
built into the code - they support, but do not replace, the club's own records of processing and DPAs.

| Principle | How the Hub implements it |
| --- | --- |
| **Lawfulness & transparency** (Art. 6, 13) | applicants accept a versioned privacy notice; `consent_at` and `consent_version` are stored per application. Outreach e-mails name the sender and carry an unsubscribe link |
| **Data minimisation** (Art. 5 1c) | reviewers see only what they need - blind screening hides name and university; imported spreadsheets are not stored, only parsed rows, and raw rows are cleared after the import |
| **Storage limitation** (Art. 5 1e) | rejected, withdrawn and declined applications are anonymised automatically after the cycle's retention period (daily job): CV deleted, name and contact replaced, comments removed. Scores stay, without the person, for statistics |
| **Integrity & confidentiality** (Art. 5 1f, 32) | row-level security in the database for every role; CVs in a private bucket, served only after an access check; EU hosting; secrets only on the server; security headers; append-only audit log |
| **Right of access** (Art. 15) | *Admin → Privacy*: complete JSON export per e-mail address; other people's identities (reviewers) are pseudonymised; the export is logged |
| **Right to erasure** (Art. 17) | *Admin → Privacy*: deletes the person, anonymises applications, removes outreach notes and adds the address to the suppression list so it is never contacted again |
| **Right to object to direct marketing** (Art. 21) | unsubscribe link and RFC 8058 one-click unsubscribe; suppression list checked before every single e-mail; queued e-mails and follow-ups are cancelled immediately |
| **Accountability** (Art. 5 2) | audit log of decisions, role changes, exports, imports and deletions; AI calls logged with purpose and cost |
| **Automated decisions** (Art. 22) | no decision is automated: AI extracts facts and drafts text, scores rank leads, the optimiser proposes reviewer assignments - a person decides every stage change |

## Open points before real data

- final privacy notice text and controller contact (`app/privacy/page.tsx`)
- DPAs with Supabase, Vercel, Resend and, if used live, Anthropic
- retention periods per cycle agreed by the board
- who holds the admin role (two people recommended, not more)
