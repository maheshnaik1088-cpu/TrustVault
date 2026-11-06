import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { resetStore } from '../src/store.js';

async function login(username, password) {
  const app = createApp();
  const server = app.listen(0);
  const { port } = server.address();

  try {
    const res = await fetch(`http://localhost:${port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const body = await res.json();
    return { app, port, token: body.token, user: body.user, response: res };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withServer(handler) {
  const app = createApp();
  const server = app.listen(0);
  const { port } = server.address();

  try {
    await handler(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('owner can grant access and viewer can access the document', async () => {
  await resetStore();
  await withServer(async (port) => {
    const ownerLogin = await login('owner1', 'Owner123!');
    const viewerLogin = await login('viewer1', 'Viewer123!');

    const createRes = await fetch(`http://localhost:${port}/api/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerLogin.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Internal-Notice.txt',
        category: 'HR',
        content: 'New policy changes for Q2 employee review.',
        contentType: 'text/plain',
        size: 52,
      }),
    });
    const created = await createRes.json();
    assert.equal(createRes.status, 201);

    const grantRes = await fetch(`http://localhost:${port}/api/documents/${created.doc.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerLogin.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'viewer1', access: 'read' }),
    });
    const granted = await grantRes.json();
    assert.equal(grantRes.status, 200);
    assert.ok(granted.doc.permissions.some((entry) => entry.userId === 'user-viewer1'));

    const readRes = await fetch(`http://localhost:${port}/api/documents/${created.doc.id}`, {
      headers: { Authorization: `Bearer ${viewerLogin.token}` },
    });

    const documentBody = await readRes.json();
    assert.equal(readRes.status, 200);
    assert.equal(documentBody.doc.name, 'Internal-Notice.txt');
  });
});

test('viewer without permission cannot access another user document', async () => {
  await resetStore();
  await withServer(async (port) => {
    const ownerLogin = await login('owner1', 'Owner123!');
    const viewerLogin = await login('viewer2', 'Viewer123!');

    const listRes = await fetch(`http://localhost:${port}/api/documents`, {
      headers: { Authorization: `Bearer ${ownerLogin.token}` },
    });
    const documents = await listRes.json();
    const target = documents.docs.find((doc) => doc.name === 'Q4 Budget Summary.pdf');

    assert.ok(target, 'Seed document should exist');

    const forbidden = await fetch(`http://localhost:${port}/api/documents/${target.id}`, {
      headers: { Authorization: `Bearer ${viewerLogin.token}` },
    });

    const detail = await forbidden.json();
    assert.equal(forbidden.status, 403);
    assert.match(detail.error, /access/i);
  });
});

test('permission revocation blocks access immediately without relying on token expiry', async () => {
  await resetStore();
  await withServer(async (port) => {
    const ownerLogin = await login('owner1', 'Owner123!');
    const viewerLogin = await login('viewer1', 'Viewer123!');

    const createRes = await fetch(`http://localhost:${port}/api/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerLogin.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Board-Notes.txt',
        category: 'Strategy',
        content: 'Quarterly board notes are confidential and shared on a need-to-know basis.',
        contentType: 'text/plain',
        size: 90,
      }),
    });
    const created = await createRes.json();

    await fetch(`http://localhost:${port}/api/documents/${created.doc.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerLogin.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'viewer1', access: 'read' }),
    });

    const before = await fetch(`http://localhost:${port}/api/documents/${created.doc.id}`, {
      headers: { Authorization: `Bearer ${viewerLogin.token}` },
    });
    assert.equal(before.status, 200);

    const revokeRes = await fetch(`http://localhost:${port}/api/documents/${created.doc.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerLogin.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'viewer1', access: 'none' }),
    });
    assert.equal(revokeRes.status, 200);

    const after = await fetch(`http://localhost:${port}/api/documents/${created.doc.id}`, {
      headers: { Authorization: `Bearer ${viewerLogin.token}` },
    });
    const blocked = await after.json();
    assert.equal(after.status, 403);
    assert.match(blocked.error, /access/i);
  });
});
