# TrustVault

TrustVault is a secure document-sharing platform built with a MERN-style structure using JavaScript across the stack and a JSON file store instead of MongoDB. The backend is Express; the frontend is a Vite + React app. The platform enforces access on the server for every document route and maintains a tamper-evident audit trail.

## Roles and permissions

The system includes three roles:

- Administrator: can inspect all activity, review the audit trail, and manage all documents.
- Document owner: can upload, view, edit, delete, and grant or revoke access on their own documents.
- Viewer: can only read documents explicitly shared with them.

Owners can grant read or edit permission to named users. Access is checked on every secured route and every access denial is recorded.

## Local setup

From a clean clone:

1. Install backend dependencies:
   ```bash
   cd backend
   npm install
   ```
2. Start the API:
   ```bash
   npm start
   ```
3. In a second terminal, install and start the frontend:
   ```bash
   cd frontend
   npm install
   npm run dev -- --host 0.0.0.0
   ```
4. Open the frontend at http://localhost:5173

## Deploying to Render

Deploy the backend and frontend as separate Render services:

1. Create a **Web Service** for the `backend` directory. Use `npm install` as the build command and `npm start` as the start command. Add a `JWT_SECRET` environment variable containing a long random secret; Render supplies `PORT`.
2. Create a **Static Site** for the `frontend` directory. Use `npm install && npm run build` as the build command and `dist` as the publish directory.
3. If your backend has a different URL from the configured production default (`https://trustvault-backend-vcsh.onrender.com/api`), set `VITE_API_URL` in the frontend Static Site's **Environment** settings to the backend's public URL followed by `/api`.
4. Save the environment variable if you changed it, then trigger a new frontend deploy. `VITE_API_URL` is embedded during the build; `.env.example` is only a template and is not loaded by Render automatically.
5. Check `https://your-backend.onrender.com/health` returns JSON with `"ok": true`, then sign in again.

If login reports that the API returned a non-JSON response, the frontend is reaching a page instead of the API. Correct `VITE_API_URL` and redeploy the frontend. The backend login endpoint is `/api/login`; do not omit `/api` from the configured base URL.

## Default users and credentials

- Admin: `admin` / `Admin123!`
- Owner: `owner1` / `Owner123!`
- Viewer 1: `viewer1` / `Viewer123!`
- Viewer 2: `viewer2` / `Viewer123!`

## JSON data store

The project uses a local JSON datastore instead of MongoDB. The active file is:

- `backend/data/store.json`

To reset to seed data:

```bash
cd backend
node scripts/reset-store.js
```

## Security model

- Every read, write, download, delete and permission change is authorized by the backend.
- The authorization decision is made against the current document permission list, not against a stale token.
- Access removal is immediate because each secured route resolves an updated document and checks `permissions` every request.
- The audit trail is a hash chain. Each record stores `previousHash`, `hash`, and the prior entry digest, so changes are visible.

## API documentation

Base URL: `http://localhost:5000/api`

| Endpoint | Method | Who can call it | Notes |
| --- | --- | --- | --- |
| `/login` | POST | Any authenticated user with known credentials | Logs in and issues a signed session token |
| `/me` | GET | Any authenticated user | Returns the current user profile |
| `/documents` | GET | Any authenticated user | Lists documents visible to the caller |
| `/documents` | POST | Any authenticated user | Uploads a new document; owner is recorded |
| `/documents/:documentId` | GET | Any user with read access | Returns the document metadata and content when authorized |
| `/documents/:documentId/download` | GET | Any user with read access | Returns the file blob for download |
| `/documents/:documentId` | PUT | Owner or admin with edit access | Updates document content and metadata |
| `/documents/:documentId` | DELETE | Owner or admin with edit access | Soft deletes the document |
| `/documents/:documentId/permissions` | POST | Owner or admin | Grants or revokes read/edit access |
| `/admin/activity` | GET | Admin only | Returns the linked audit log and integrity status |
| `/health` | GET | Anyone | Health check |

## Tests

```bash
cd backend
npm test
```

The backend test suite includes authorization checks that cover:

- owner-granted access works for an approved viewer,
- a user without permission cannot read another user’s file,
- access revocation blocks the viewer immediately.

## Threat model summary

See `THREATS.md` for the full risk register. The application deliberately keeps a small but hardened permission model: per-document access grants, immediate per-request re-checks, and a tamper-evident audit chain.

## Notes

The project is designed for a small, secure internal document-sharing workflow rather than a full enterprise DLP suite. It explicitly avoids file-system path disclosure and only stores JSON in a local data file for the assignment environment.
