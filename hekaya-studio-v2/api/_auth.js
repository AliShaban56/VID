import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'hekaya_access';
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;

function sessionSecret() {
  return process.env.APP_SESSION_SECRET || process.env.APP_ACCESS_PASSWORD || '';
}

function cookie(req, name) {
  const raw = String(req?.headers?.cookie || '');
  const item = raw.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
  if (!item) return '';
  try { return decodeURIComponent(item.slice(name.length + 1)); } catch { return ''; }
}

export function hasAccess(req) {
  const secret = sessionSecret();
  if (!secret || !process.env.APP_ACCESS_PASSWORD) return false;
  const token = cookie(req, COOKIE_NAME);
  const [expiryText, signature] = token.split('.');
  const expiry = Number(expiryText);
  if (!Number.isSafeInteger(expiry) || expiry <= Date.now() || expiry > Date.now() + MAX_SESSION_MS + 60_000 || !signature) return false;
  const expected = createHmac('sha256', secret).update('hekaya-session-v1:' + expiryText).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireAccess(req, res) {
  if (hasAccess(req)) return true;
  res.setHeader('Cache-Control', 'no-store');
  res.status(401).json({ error: 'Unauthorized', authenticated: false });
  return false;
}
