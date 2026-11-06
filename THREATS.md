# Threat model and mitigations

## 1. Direct object reference / ID guessing

Threat: a user tries to call a document route with another user’s `documentId` or a guessed ID.

Mitigation: each secured route loads the document fresh from the JSON store, checks the caller’s identity, and applies the server-side permission model before returning content. There is no URL-based bypass or path lookup. Access is granted only if `document.ownerId === user.id`, the user is an admin, or a matching permission exists with the correct access level.

## 2. Stale permissions / session replay

Threat: a user previously received access, then it was removed, but the old token still works.

Mitigation: authorization is enforced against the current document permission list on every request. The token proves identity, but the document’s `permissions` list proves authorization at the moment of access. Removing access immediately blocks subsequent calls, even if the token is still valid.

## 3. Permission escalation via API payload tampering

Threat: a viewer sends a crafted permission change request to change another user’s access.

Mitigation: the endpoint rejects requests unless the actor is the owner or an admin. The server checks role and ownership before mutating `permissions`. All attempted changes are logged in the audit trail as `permission_change` entries with `allowed: false`.

## 4. Hidden route bypass or accidental route exposure

Threat: business logic is correct in one UI flow but bypassed through another endpoint or by a direct API call.

Mitigation: authorization is centralized in route middleware (`requireAuth`, `requireDocumentAccess`, `requireDocumentEdit`). The UI is only a convenience layer; the server is the final authority. Every document route enforces a check and records denial attempts.

## 5. Audit trail tampering

Threat: someone edits the stored audit log to hide a download or access denial.

Mitigation: the audit trail is chained with `previousHash` and `hash` values generated from the entire previous event. Any insertion, reorder, or edit breaks verification. The admin activity endpoint reports a `integrity` Boolean from `verifyAuditTrail`.

## 6. Untrusted file uploads and oversized payloads

Threat: a malicious user uploads invalid file types, extremely large files, or empty content.

Mitigation: uploads are validated for presence, file extension, and size. The maximum supported document size is 5MB and the accepted extensions are limited to typical text and office formats.

## 7. Content leakage through the “download” API

Threat: a user tries to bypass the document view route and fetch the file directly using the download endpoint.

Mitigation: both the view and download endpoints enforce the same server-side read authorization gate. If access is denied, a record is created and a 403 is returned.

## 8. Document deletion or overwrite without ownership

Threat: a user with a valid token tries to edit or delete another user’s document.

Mitigation: edit access is routed through the server-side `requireDocumentEdit` gate, which authorizes only the owner/admin or users with `edit` permission. Deletes are soft deletes and are still audited.

## 9. Reused default secret / weak crypto assumptions

Threat: the service uses a default JWT secret and weak single-pass hashing if deployed without an environment variable.

Mitigation: the code reads `JWT_SECRET` from the environment and falls back to a development secret only for local use. For production, operators must set a strong secret. Passwords are hashed with HMAC-SHA256, not stored in plaintext.

## 10. Acceptable limitations

This build intentionally leaves out enterprise-grade features such as SSO, object storage, multi-tenant isolation, and external encryption-at-rest controls. Those are valid additions for production, but they are not required for the security exercise. The design focus here is per-document authorization, immediate revocation, and verifiable audit records.
