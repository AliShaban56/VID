import { hasAccess } from '../api/_auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.APP_ACCESS_PASSWORD) return res.status(503).json({ error: 'Set APP_ACCESS_PASSWORD in Vercel Environment Variables first.' });
  if (!hasAccess(req)) return res.status(401).json({ authenticated: false });
  return res.status(200).json({ authenticated: true });
}
