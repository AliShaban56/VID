import { timingSafeEqual } from 'node:crypto';

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const expected = process.env.APP_ACCESS_PASSWORD;
  if (!expected) return res.status(503).json({ error: 'Set APP_ACCESS_PASSWORD in Vercel Environment Variables first.' });
  const supplied = String(req.body?.password || '');
  if (!supplied || !safeEqual(supplied, expected)) return res.status(401).json({ error: 'كلمة المرور غير صحيحة.' });
  res.setHeader('Set-Cookie', 'hekaya_access=' + encodeURIComponent(expected) + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200');
  return res.status(200).json({ ok: true });
}
