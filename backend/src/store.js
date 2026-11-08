import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { hashPassword } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, '../data/store.json');

const toIso = () => new Date().toISOString();

function createAuditHash(previousHash, record) {
  return createHash('sha256').update(`${previousHash}:${JSON.stringify(record)}`).digest('hex');
}

export function getUserSafe(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
}

export function createSeedStore() {
  return {
    users: [
      {
        id: 'user-admin',
        username: 'admin',
        passwordHash: hashPassword('Admin123!'),
        displayName: 'System Administrator',
        role: 'admin',
      },
      {
        id: 'user-owner',
        username: 'owner1',
        passwordHash: hashPassword('Owner123!'),
        displayName: 'Maya Owner',
        role: 'owner',
      },
      {
        id: 'user-viewer1',
        username: 'viewer1',
        passwordHash: hashPassword('Viewer123!'),
        displayName: 'Noah Viewer',
        role: 'viewer',
      },
      {
        id: 'user-viewer2',
        username: 'viewer2',
        passwordHash: hashPassword('Viewer123!'),
        displayName: 'Priya Viewer',
        role: 'viewer',
      },
    ],
    documents: [
      {
        id: 'doc-001',
        name: 'Q4 Budget Summary.pdf',
        category: 'Finance',
        ownerId: 'user-owner',
        content: 'Sensitive quarterly budget information for the board review only.\n\nRevenue target: 8.4M.\nCost save target: 1.2M.\nConfidential until signed off.',
        contentType: 'application/pdf',
        size: 1230,
        createdAt: toIso(),
        updatedAt: toIso(),
        deleted: false,
        permissions: [
          { userId: 'user-owner', access: 'edit' },
          { userId: 'user-viewer1', access: 'read' },
        ],
      },
      {
        id: 'doc-002',
        name: 'Customer Contract Draft.docx',
        category: 'Legal',
        ownerId: 'user-owner',
        content: 'This document contains the draft customer contract terms and redlines. Access is restricted to the account owner and the legal team.',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 1850,
        createdAt: toIso(),
        updatedAt: toIso(),
        deleted: false,
        permissions: [
          { userId: 'user-owner', access: 'edit' },
        ],
      },
    ],
    auditTrail: [],
  };
}

export async function resetStore() {
  const seed = createSeedStore();
  await fs.writeFile(DATA_PATH, JSON.stringify(seed, null, 2), 'utf8');
  return seed;
}

export async function readStore() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    const seed = createSeedStore();
    await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
    await fs.writeFile(DATA_PATH, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
}

export async function writeStore(store) {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, JSON.stringify(store, null, 2), 'utf8');
}

export async function getUserByUsername(username) {
  const store = await readStore();
  return store.users.find((user) => user.username.toLowerCase() === String(username).toLowerCase()) || null;
}

export async function getUserById(id) {
  const store = await readStore();
  return store.users.find((user) => user.id === id) || null;
}

export async function listAllDocuments() {
  const store = await readStore();
  return store.documents.filter((doc) => !doc.deleted);
}

export async function getDocumentById(documentId) {
  const store = await readStore();
  return store.documents.find((doc) => doc.id === documentId && !doc.deleted) || null;
}

export async function saveDocument(document) {
  const store = await readStore();
  const index = store.documents.findIndex((item) => item.id === document.id);
  if (index >= 0) {
    store.documents[index] = document;
  } else {
    store.documents.push(document);
  }
  await writeStore(store);
  return document;
}

export function checkDocumentAccess(document, user, mode = 'read') {
  if (!document || !user) {
    return false;
  }

  if (user.role === 'admin' || document.ownerId === user.id) {
    return true;
  }

  const permission = document.permissions?.find((entry) => entry.userId === user.id);
  if (!permission) {
    return false;
  }

  return permission.access === 'edit' || (mode === 'read' && permission.access === 'read');
}

export async function appendAuditEvent(event) {
  const store = await readStore();
  const previousEntry = store.auditTrail.at(-1) || null;
  const previousHash = previousEntry ? previousEntry.hash : 'GENESIS';
  const entry = {
    id: randomUUID(),
    sequence: store.auditTrail.length + 1,
    timestamp: toIso(),
    previousHash,
    ...event,
  };

  entry.hash = createAuditHash(previousHash, {
    ...entry,
    hash: undefined,
  });

  store.auditTrail.push(entry);
  await writeStore(store);
  return entry;
}

export function verifyAuditTrail(auditTrail) {
  let previousHash = 'GENESIS';

  for (const entry of auditTrail) {
    const expectedHash = createAuditHash(previousHash, {
      ...entry,
      hash: undefined,
    });

    if (entry.previousHash !== previousHash || entry.hash !== expectedHash) {
      return false;
    }

    previousHash = entry.hash;
  }

  return true;
}

export async function getVisibleDocumentsForUser(user) {
  const store = await readStore();
  if (!user) return [];
  if (user.role === 'admin') {
    return [...store.documents.filter((doc) => !doc.deleted)];
  }

  return store.documents.filter((doc) => {
    if (doc.deleted) return false;
    if (doc.ownerId === user.id) return true;
    const permission = doc.permissions?.find((entry) => entry.userId === user.id);
    return Boolean(permission && (permission.access === 'read' || permission.access === 'edit'));
  });
}

export function sanitizeDocument(document, user) {
  if (!document) return null;
  const permission = document.permissions?.find((entry) => entry.userId === user.id);
  const canRead = checkDocumentAccess(document, user, 'read');

  return {
    id: document.id,
    name: document.name,
    category: document.category,
    ownerId: document.ownerId,
    ownerName: document.ownerName || '',
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    size: document.size,
    contentType: document.contentType,
    contentEncoding: document.contentEncoding || 'utf-8',
    permissions: document.permissions || [],
    content: canRead ? document.content : null,
    canEdit: Boolean(document.ownerId === user.id || user.role === 'admin' || (permission && permission.access === 'edit')),
  };
}

export async function userExists(username) {
  const user = await getUserByUsername(username);
  return Boolean(user);
}

export function isValidUpload({ name, content, size, contentType }) {
  const allowedExtensions = ['.txt', '.pdf', '.doc', '.docx', '.csv', '.md', '.jpg', '.jpeg', '.png'];
  const safeName = String(name || '').trim();

  if (!safeName || !content || String(content).trim().length < 10) {
    return { valid: false, reason: 'Upload missing required content.' };
  }

  const extension = safeName.slice(safeName.lastIndexOf('.')).toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    return { valid: false, reason: 'Unsupported file type.' };
  }

  if (Number(size || 0) > 5 * 1024 * 1024) {
    return { valid: false, reason: 'File exceeds 5MB limit.' };
  }

  return { valid: true };
}
