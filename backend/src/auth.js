import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.JWT_SECRET || 'trustvault-dev-secret';

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export function hashPassword(value) {
  return createHmac('sha256', SECRET).update(String(value)).digest('hex');
}

export function signToken(user) {
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    name: user.displayName,
    exp: Date.now() + 1000 * 60 * 60 * 8,
  };

  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'session' }));
  const body = toBase64Url(JSON.stringify(payload));
  const signature = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');

  return `${header}.${body}.${signature}`;
}

export function verifyToken(token) {
  if (!token) {
    throw new Error('Missing token');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed token');
  }

  const [header, body, signature] = parts;
  const expected = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');

  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(fromBase64Url(body));
  if (Date.now() > payload.exp) {
    throw new Error('Token expired');
  }

  return {
    id: payload.sub,
    username: payload.username,
    role: payload.role,
    displayName: payload.name,
  };
}
