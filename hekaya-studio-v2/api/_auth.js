import { createHmac, timingSafeEqual } from 'node:crypto';

function signature(expiry, secret) {
  return createHmac('sha256', secret).update('hekaya-session-v1:' + expiry).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hasAccess(req) {
  const secret = process.env.APP_ACCESS_PASSWORD;
  if (!secret) return false;
  const raw = String(req.headers?.cookie || '');
  const item = raw.split(';').map(v => v.trim()).find(v => v.startsWith('hekaya_access='));
  if (!item) return false;
  let token = '';
  try { token = decodeURIComponent(item.slice('hekaya_access='.length)); } catch { return false; }
  const [expiry, received] = token.split('.');
  if (!/^\d{13}$/.test(expiry || '') || !received) return false;
  const expiresAt = Number(expiry);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false;
  return safeEqual(received, signature(expiry, secret));
}

export function requireAccess(req, res) {
  if (!process.env.APP_ACCESS_PASSWORD) {
    res.status(503).json({ error: 'Set APP_ACCESS_PASSWORD in Vercel Environment Variables before using this private studio.' });
    return false;
  }
  if (!hasAccess(req)) {
    res.status(401).json({ error: 'Authentication required.' });
    return false;
  }
  return true;
}
