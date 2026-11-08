import { useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (let index = 0; index < bytes.length; index += 0x8000) {
    const chunk = bytes.subarray(index, index + 0x8000);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const normalized = base64.replace(/\s/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function isTextFile(file) {
  const name = file.name || '';
  const type = (file.type || '').toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  const binaryExtensions = new Set([
    '.doc', '.docx', '.pdf', '.xls', '.xlsx', '.ppt', '.pptx',
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.zip', '.rar',
    '.exe', '.dll', '.bin', '.iso', '.odt', '.ods', '.odp', '.heic',
  ]);

  if (binaryExtensions.has(extension)) {
    return false;
  }

  return /^text\//.test(type)
    || /\.(txt|csv|md|json|xml|html|htm|js|jsx|ts|tsx|css|svg|rtf|yaml|yml)$/i.test(name)
    || /(json|xml|javascript|csv|css|html|svg|yaml|yml)/i.test(type);
}

async function apiRequest(path, options = {}, token) {
  const headers = {
    ...(options.headers || {}),
  };

  if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const hasJson = response.headers.get('content-type')?.includes('application/json');
  const payload = hasJson ? await response.json() : null;

  if (!response.ok) {
    throw new Error(payload?.error || 'Request failed');
  }

  return payload;
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('trustvault-token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('trustvault-user') || 'null'));
  const [documents, setDocuments] = useState([]);
  const [auditTrail, setAuditTrail] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [uploadForm, setUploadForm] = useState({
    name: '',
    category: 'General',
    content: '',
    contentType: 'text/plain',
    contentEncoding: 'utf-8',
    size: 0,
  });
  const [permissionForm, setPermissionForm] = useState({
    documentId: '',
    username: '',
    access: 'read',
  });

  const selectedDocument = useMemo(
    () => documents.find((doc) => doc.id === selectedId) || documents[0] || null,
    [documents, selectedId],
  );

  useEffect(() => {
    if (selectedDocument && !permissionForm.documentId) {
      setPermissionForm((current) => ({ ...current, documentId: selectedDocument.id }));
    }
  }, [selectedDocument]);

  const loadDocuments = async (currentToken = token) => {
    if (!currentToken) {
      setDocuments([]);
      return;
    }

    const data = await apiRequest('/documents', {}, currentToken);
    setDocuments(data.docs || []);
    if (!selectedId && (data.docs || []).length > 0) {
      setSelectedId(data.docs[0].id);
    }
  };

  const loadAuditTrail = async (currentToken = token) => {
    if (!currentToken || user?.role !== 'admin') {
      setAuditTrail([]);
      return;
    }

    const data = await apiRequest('/admin/activity', {}, currentToken);
    setAuditTrail(data.auditTrail || []);
  };

  useEffect(() => {
    if (!token) {
      setDocuments([]);
      setAuditTrail([]);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        await loadDocuments(token);
        await loadAuditTrail(token);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const savePersistedSession = (nextToken, nextUser) => {
    localStorage.setItem('trustvault-token', nextToken || '');
    localStorage.setItem('trustvault-user', JSON.stringify(nextUser || null));
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = form.get('username');
    const password = form.get('password');

    try {
      setError('');
      const response = await apiRequest('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      setToken(response.token);
      setUser(response.user);
      savePersistedSession(response.token, response.user);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleLogout = () => {
    setToken('');
    setUser(null);
    setDocuments([]);
    setAuditTrail([]);
    savePersistedSession('', null);
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    try {
      setError('');
      const response = await apiRequest('/documents', {
        method: 'POST',
        body: JSON.stringify({
          name: uploadForm.name,
          category: uploadForm.category,
          content: uploadForm.content,
          contentType: uploadForm.contentType || 'text/plain',
          contentEncoding: uploadForm.contentEncoding || 'utf-8',
          size: uploadForm.size || uploadForm.content.length,
        }),
      }, token);

      setUploadForm({ name: '', category: 'General', content: '', contentType: 'text/plain', contentEncoding: 'utf-8', size: 0 });
      await loadDocuments(token);
      setSelectedId(response.doc.id);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDownload = async (documentId) => {
    try {
      const response = await apiRequest(`/documents/${documentId}/download`, {}, token);
      const isBase64 = response.contentEncoding === 'base64';
      const bytes = isBase64 ? base64ToUint8Array(response.content || '') : response.content || '';
      const blob = new Blob([bytes], { type: response.contentType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = response.name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePermissionChange = async (event) => {
    event.preventDefault();
    try {
      setError('');
      const payload = {
        username: permissionForm.username,
        access: permissionForm.access,
      };

      await apiRequest(`/documents/${permissionForm.documentId}/permissions`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }, token);

      setPermissionForm({ documentId: '', username: '', access: 'read' });
      await loadDocuments(token);
      await loadAuditTrail(token);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (documentId) => {
    try {
      await apiRequest(`/documents/${documentId}`, { method: 'DELETE' }, token);
      await loadDocuments(token);
      await loadAuditTrail(token);
    } catch (err) {
      setError(err.message);
    }
  };

  const filteredDocuments = useMemo(() => {
    const q = search.toLowerCase();
    return documents.filter((doc) => {
      const matches = !q || doc.name.toLowerCase().includes(q) || doc.category.toLowerCase().includes(q);
      return matches;
    });
  }, [documents, search]);

  const handleFileRead = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (isTextFile(file)) {
      const reader = new FileReader();
      reader.onload = () => {
        setUploadForm((current) => ({
          ...current,
          name: file.name,
          content: String(reader.result || ''),
          contentType: file.type || 'text/plain',
          contentEncoding: 'utf-8',
          size: file.size,
        }));
      };
      reader.readAsText(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result;
      const content = buffer instanceof ArrayBuffer ? arrayBufferToBase64(buffer) : btoa(String(buffer || ''));

      setUploadForm((current) => ({
        ...current,
        name: file.name,
        content,
        contentType: file.type || 'application/octet-stream',
        contentEncoding: 'base64',
        size: file.size,
      }));
    };
    reader.readAsArrayBuffer(file);
  };

  const previewContent = selectedDocument && (
    selectedDocument.contentType && !/^text\//.test(selectedDocument.contentType) && !/json|xml|javascript|csv/.test(selectedDocument.contentType)
      ? 'Binary document — download it to view the original file.'
      : selectedDocument.content || 'No content visible — document access is restricted.'
  );

  if (!user || !token) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="brand-row">
            <div className="brand-mark">TV</div>
            <div>
              <h1>TrustVault</h1>
              <p>Secure document sharing with an audit trail</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="auth-form">
            <h2>Sign in</h2>
            <label>
              Username
              <input name="username" defaultValue="owner1" required />
            </label>
            <label>
              Password
              <input name="password" type="password" defaultValue="Owner123!" required />
            </label>
            <button type="submit">Continue</button>
          </form>

          <div className="credential-list">
            <h3>Seed roles</h3>
            <ul>
              <li>admin / Admin123!</li>
              <li>owner1 / Owner123!</li>
              <li>viewer1 / Viewer123!</li>
              <li>viewer2 / Viewer123!</li>
            </ul>
          </div>
          {error && <div className="error-banner">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>TrustVault</h1>
          <small>Role: {user.role}</small>
        </div>
        <div className="topbar-actions">
          <span>{user.displayName}</span>
          <button type="button" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main className="main-grid">
        <section className="panel">
          <h2>Upload document</h2>
          <form onSubmit={handleUpload} className="stack-form">
            <label>
              File name
              <input
                value={uploadForm.name}
                onChange={(event) => setUploadForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Q4_budget.pdf"
                required
              />
            </label>
            <label>
              Category
              <input
                value={uploadForm.category}
                onChange={(event) => setUploadForm((current) => ({ ...current, category: event.target.value }))}
              />
            </label>
            <label>
              Upload file (optional)
              <input type="file" onChange={handleFileRead} />
            </label>
            <label>
              Content
              <textarea
                value={uploadForm.content}
                onChange={(event) => setUploadForm((current) => ({ ...current, content: event.target.value }))}
                rows={8}
                required
              />
            </label>
            <button type="submit">Create document</button>
          </form>
        </section>

        <section className="panel">
          <h2>Search & access</h2>
          <div className="search-box">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or category"
            />
          </div>

          <div className="list-stack">
            {filteredDocuments.map((doc) => (
              <div
                key={doc.id}
                className={`doc-card ${selectedDocument?.id === doc.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(doc.id)}
              >
                <h3>{doc.name}</h3>
                <p>{doc.category}</p>
                <small>{doc.content ? 'Content available' : 'Restricted'}</small>
                <div className="inline-actions">
                  <button type="button" onClick={(event) => { event.stopPropagation(); handleDownload(doc.id); }}>
                    Download
                  </button>
                  {user.role === 'admin' || doc.ownerId === user.id ? (
                    <button type="button" className="warning" onClick={(event) => { event.stopPropagation(); handleDelete(doc.id); }}>
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        {selectedDocument && (
          <section className="panel detail-panel">
            <h2>{selectedDocument.name}</h2>
            <div className="meta-row">
              <span>Category: {selectedDocument.category}</span>
              <span>Updated: {new Date(selectedDocument.updatedAt).toLocaleString()}</span>
            </div>
            <pre>{previewContent}</pre>

            <div className="permission-box">
              <h3>Document permissions</h3>
              <ul>
                {(selectedDocument.permissions || []).map((entry) => (
                  <li key={`${selectedDocument.id}-${entry.userId}`}>
                    {entry.userId} → {entry.access}
                  </li>
                ))}
              </ul>
            </div>

            {user.role === 'admin' || selectedDocument.ownerId === user.id ? (
              <form onSubmit={handlePermissionChange} className="stack-form inline-form">
                <input
                  value={permissionForm.documentId || selectedDocument.id}
                  onChange={(event) => setPermissionForm((current) => ({ ...current, documentId: event.target.value }))}
                  placeholder="Document ID"
                  hidden
                />
                <label>
                  Target user
                  <input
                    value={permissionForm.username}
                    onChange={(event) => setPermissionForm((current) => ({ ...current, username: event.target.value }))}
                    placeholder="viewer2"
                  />
                </label>
                <label>
                  Access
                  <select
                    value={permissionForm.access}
                    onChange={(event) => setPermissionForm((current) => ({ ...current, access: event.target.value }))}
                  >
                    <option value="read">Read</option>
                    <option value="edit">Edit</option>
                    <option value="none">Remove</option>
                  </select>
                </label>
                <button type="submit">Apply access</button>
              </form>
            ) : null}
          </section>
        )}

        {user.role === 'admin' && (
          <section className="panel admin-panel">
            <h2>Audit trail</h2>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>User</th>
                  <th>Event</th>
                  <th>Allowed</th>
                </tr>
              </thead>
              <tbody>
                {(auditTrail || []).slice(-10).reverse().map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.timestamp).toLocaleString()}</td>
                    <td>{event.type}</td>
                    <td>{event.actorName}</td>
                    <td>{event.detail}</td>
                    <td>{event.allowed ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>

      {error && <div className="error-banner fixed">{error}</div>}
      {loading && <div className="loading">Loading...</div>}
    </div>
  );
}
