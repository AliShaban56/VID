import { createHmac, timingSafeEqual } from 'node:crypto';

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.APP_ACCESS_PASSWORD;
  if (!secret) return res.status(503).json({ error: 'Set APP_ACCESS_PASSWORD in Vercel Environment Variables first.' });
  const supplied = String(req.body?.password || '');
  if (!supplied || !safeEqual(supplied, secret)) return res.status(401).json({ error: 'كلمة المرور غير صحيحة.' });

  const expiry = String(Date.now() + 12 * 60 * 60 * 1000);
  const signature = createHmac('sha256', secret).update('hekaya-session-v1:' + expiry).digest('base64url');
  const token = encodeURIComponent(expiry + '.' + signature);
  res.setHeader('Set-Cookie', 'hekaya_access=' + token + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200');
  return res.status(200).json({ ok: true });
}
