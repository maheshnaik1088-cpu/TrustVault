# PROMPTS.md

This file records the prompts and follow-up checks used while building TrustVault.

## 2026-11-01 — Initial project structure

- Prompt: “Create a secure document-sharing app with Express backend, Vite React frontend, and JSON file data. Keep the authorization logic server-side and build a role system for admin, owner, and viewer.”
- Produced: a starter folder structure and a first-pass permission model.
- What was wrong: the initial scaffolding did not yet enforce every route on the server, and the risk of a stale permission model was not yet addressed.
- What I did instead: I moved all access checks to middleware and made read/edit checks resolve the document again from the store at request time. Fix was applied in commit `2c4a7e1`.

## 2026-11-02 — Authorisation review

- Prompt: “Review the backend routes and identify any place a user could request another doc by ID and still read it.”
- Produced: a route review that highlighted the main issue: UI gating was not enough.
- What was wrong: a direct GET to a document route would still work if the route did not re-check permission.
- What I did instead: I added `requireDocumentAccess` and `requireDocumentEdit` middleware, and I logged every denial in the audit trail. Fix was applied in commit `7f91ad3`.

## 2026-11-03 — Audit record protection

- Prompt: “Design a way to detect tampering in the audit trail without using a database.”
- Produced: an initial append-only log with timestamps only.
- What was wrong: timestamps alone were easy to forge, and there was no way to detect a hidden edit or reordered entry.
- What I did instead: I changed the audit trail to a hash chain using `previousHash` and `hash` fields, and added `verifyAuditTrail` for integrity checks. Fix was applied in commit `c8090d2`.

## 2026-11-04 — Access revocation test

- Prompt: “Add a test proving access is revoked immediately even when the user token is still valid.”
- Produced: a first revocation scenario that checked the token expiry path, but that still did not prove the real behavior.
- What was wrong: it was tied to token lifetime instead of current permission state.
- What I did instead: I changed the test to grant then revoke access and assert the route is denied immediately without a token refresh. Fix was applied in commit `5ee61af`.

## 2026-11-05 — Frontend and live checks

- Prompt: “Make the Vite UI show secure document access, upload, and admin audit data without leaking hidden routes.”
- Produced: a React dashboard that rendered visible docs and a permission form.
- What was wrong: the UI could still tempt a user into direct API calls without actual permission checks.
- What I did instead: I kept the UI as a thin client and left all security decisions to the server, then verified the routes using the backend test suite. Fix was applied in commit `d4b8a2f`.

## 2026-11-06 — Final verification

- Prompt: “Run the full project tests and build checks to make sure the authorization layer still holds under load and the frontend compiles.”
- Produced: passing backend tests and a clean frontend production build.
- What was wrong: the first attempt used an invalid shell path; that was a command issue, not a code issue.
- What I did instead: I corrected the terminal path syntax and re-ran the exact validation commands to confirm the app is green. This was completed in the final verification stage after commit `d1d6ef3`.

## Reused guidance and working pattern

- The key instruction reused throughout the week: keep the security decision in one place on the server and never trust UI state.
- The most important validation approach was to test the actual API with real credentials and unauthorized access attempts, rather than asserting on mocked behavior.
