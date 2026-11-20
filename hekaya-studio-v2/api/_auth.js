import { timingSafeEqual } from 'node:crypto';

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hasAccess(req) {
  const expected = process.env.APP_ACCESS_PASSWORD;
  if (!expected) return false;
  const raw = String(req.headers?.cookie || '');
  const item = raw.split(';').map(v => v.trim()).find(v => v.startsWith('hekaya_access='));
  if (!item) return false;
  let actual = '';
  try { actual = decodeURIComponent(item.slice('hekaya_access='.length)); } catch { return false; }
  return safeEqual(actual, expected);
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
