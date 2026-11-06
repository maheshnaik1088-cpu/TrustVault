import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import {
  appendAuditEvent,
  checkDocumentAccess,
  getDocumentById,
  getUserById,
  getUserByUsername,
  getVisibleDocumentsForUser,
  readStore,
  sanitizeDocument,
  saveDocument,
  verifyAuditTrail,
  userExists,
  isValidUpload,
  writeStore,
} from './store.js';
import { hashPassword, signToken, verifyToken } from './auth.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  const requireAuth = async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    try {
      req.user = verifyToken(token);
      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }
  };

  const requireRole = (role) => (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'This role is not allowed to perform this action.' });
    }
    return next();
  };

  const requireDocumentAccess = (mode = 'read') => async (req, res, next) => {
    const doc = await getDocumentById(req.params.documentId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const allowed = checkDocumentAccess(doc, req.user, mode);
    if (!allowed) {
      await appendAuditEvent({
        type: 'access_denied',
        actorId: req.user.id,
        actorName: req.user.displayName,
        documentId: doc.id,
        detail: `Denied ${mode} access to document ${doc.name}.`,
        allowed: false,
      });
      return res.status(403).json({ error: 'You do not have access to this document.' });
    }

    req.document = doc;
    return next();
  };

  const requireDocumentEdit = async (req, res, next) => {
    const document = await getDocumentById(req.params.documentId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const allowed = checkDocumentAccess(document, req.user, 'edit');
    if (!allowed) {
      await appendAuditEvent({
        type: 'access_denied',
        actorId: req.user.id,
        actorName: req.user.displayName,
        documentId: document.id,
        detail: `Denied edit access to document ${document.name}.`,
        allowed: false,
      });
      return res.status(403).json({ error: 'Edit permission required.' });
    }

    req.document = document;
    return next();
  };

  app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'TrustVault API' });
  });

  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    const user = await getUserByUsername(username);
    if (!user || user.passwordHash !== hashPassword(password || '')) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = signToken(user);
    await appendAuditEvent({
      type: 'login',
      actorId: user.id,
      actorName: user.displayName,
      detail: `${user.displayName} logged in successfully.`,
      allowed: true,
    });

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    });
  });

  app.get('/api/me', requireAuth, async (req, res) => {
    const user = await getUserById(req.user.id);
    return res.json({
      user: user ? {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      } : null,
    });
  });

  app.get('/api/documents', requireAuth, async (req, res) => {
    const store = await readStore();
    const rows = await getVisibleDocumentsForUser(req.user);
    const filtered = rows.filter((doc) => {
      const query = (req.query.q || '').toString().toLowerCase();
      const owner = (req.query.owner || '').toString().toLowerCase();
      const category = (req.query.category || '').toString().toLowerCase();
      const date = (req.query.date || '').toString();

      const inName = !query || doc.name.toLowerCase().includes(query);
      const inOwner = !owner || (store.users.find((user) => user.id === doc.ownerId)?.displayName || '').toLowerCase().includes(owner);
      const inCategory = !category || doc.category.toLowerCase().includes(category);
      const inDate = !date || doc.createdAt.slice(0, 10) === date;

      return inName && inOwner && inCategory && inDate;
    });

    return res.json({ docs: filtered.map((doc) => sanitizeDocument(doc, req.user)) });
  });

  app.post('/api/documents', requireAuth, async (req, res) => {
    const { name, category, content, contentType, size } = req.body || {};
    const validation = isValidUpload({ name, content, size, contentType });
    if (!validation.valid) {
      return res.status(400).json({ error: validation.reason });
    }

    const store = await readStore();
    const doc = {
      id: `doc-${Date.now()}`,
      name: String(name).trim(),
      category: String(category || 'General').trim(),
      ownerId: req.user.id,
      content: String(content),
      contentType: contentType || 'text/plain',
      size: Number(size || String(content).length),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deleted: false,
      permissions: [{ userId: req.user.id, access: 'edit' }],
    };

    store.documents.push(doc);
    await writeStore(store);

    await appendAuditEvent({
      type: 'upload',
      actorId: req.user.id,
      actorName: req.user.displayName,
      documentId: doc.id,
      detail: `Uploaded document ${doc.name}.`,
      allowed: true,
    });

    return res.status(201).json({ doc: sanitizeDocument(doc, req.user) });
  });

  app.get('/api/documents/:documentId', requireAuth, requireDocumentAccess('read'), async (req, res) => {
    await appendAuditEvent({
      type: 'view',
      actorId: req.user.id,
      actorName: req.user.displayName,
      documentId: req.document.id,
      detail: `${req.user.displayName} viewed document ${req.document.name}.`,
      allowed: true,
    });

    return res.json({ doc: sanitizeDocument(req.document, req.user) });
  });

  app.get('/api/documents/:documentId/download', requireAuth, requireDocumentAccess('read'), async (req, res) => {
    await appendAuditEvent({
      type: 'download',
      actorId: req.user.id,
      actorName: req.user.displayName,
      documentId: req.document.id,
      detail: `${req.user.displayName} downloaded document ${req.document.name}.`,
      allowed: true,
    });

    return res.json({
      name: req.document.name,
      category: req.document.category,
      content: req.document.content,
      contentType: req.document.contentType,
      size: req.document.size,
    });
  });

  app.put('/api/documents/:documentId', requireAuth, requireDocumentEdit, async (req, res) => {
    const { name, category, content, contentType, size } = req.body || {};
    const validation = isValidUpload({ name: name || req.document.name, content: content || req.document.content, size: size || req.document.size, contentType: contentType || req.document.contentType });
    if (!validation.valid) {
      return res.status(400).json({ error: validation.reason });
    }

    const updated = {
      ...req.document,
      name: String(name || req.document.name).trim(),
      category: String(category || req.document.category).trim(),
      content: String(content || req.document.content),
      contentType: contentType || req.document.contentType,
      size: Number(size || req.document.size || String(content || req.document.content).length),
      updatedAt: new Date().toISOString(),
    };

    await saveDocument(updated);
    await appendAuditEvent({
      type: 'update',
      actorId: req.user.id,
      actorName: req.user.displayName,
      documentId: updated.id,
      detail: `${req.user.displayName} updated document ${updated.name}.`,
      allowed: true,
    });

    return res.json({ doc: sanitizeDocument(updated, req.user) });
  });

  app.delete('/api/documents/:documentId', requireAuth, requireDocumentEdit, async (req, res) => {
    const doc = { ...req.document, deleted: true, updatedAt: new Date().toISOString() };
    await saveDocument(doc);

    await appendAuditEvent({
      type: 'delete',
      actorId: req.user.id,
      actorName: req.user.displayName,
      documentId: doc.id,
      detail: `${req.user.displayName} deleted document ${doc.name}.`,
      allowed: true,
    });

    return res.json({ success: true });
  });

  app.post('/api/documents/:documentId/permissions', requireAuth, async (req, res) => {
    const document = await getDocumentById(req.params.documentId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    if (req.user.role !== 'admin' && document.ownerId !== req.user.id) {
      await appendAuditEvent({
        type: 'permission_change',
        actorId: req.user.id,
        actorName: req.user.displayName,
        documentId: document.id,
        detail: 'Attempted to change permissions without owner rights.',
        allowed: false,
      });
      return res.status(403).json({ error: 'Only the owner or an admin can change permissions.' });
    }

    const { username, access } = req.body || {};
    const targetUser = await getUserByUsername(username);
    if (!targetUser) {
      return res.status(404).json({ error: 'Target user not found.' });
    }

    const nextPermissions = document.permissions.filter((entry) => entry.userId !== targetUser.id);
    if (access && access !== 'none') {
      nextPermissions.push({ userId: targetUser.id, access });
    }
    document.permissions = nextPermissions;
    document.updatedAt = new Date().toISOString();

    await saveDocument(document);
    await appendAuditEvent({
      type: 'permission_change',
      actorId: req.user.id,
      actorName: req.user.displayName,
      documentId: document.id,
      detail: `${req.user.displayName} set ${targetUser.username} to ${access || 'none'} access.`,
      allowed: true,
    });

    return res.json({ doc: sanitizeDocument(document, req.user) });
  });

  app.get('/api/admin/activity', requireAuth, requireRole('admin'), async (req, res) => {
    const store = await readStore();
    const integrity = verifyAuditTrail(store.auditTrail);
    return res.json({
      auditTrail: store.auditTrail,
      integrity,
    });
  });

  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: 'Unexpected server error.' });
  });

  return app;
}
