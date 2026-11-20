import { requireAccess } from './_auth.js';
import { init } from './_db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAccess(req, res)) return;

  const key = process.env.SHOTSTACK_API_KEY;
  if (!key) return res.status(503).json({ error: 'SHOTSTACK_API_KEY is not configured.' });
  const id = String(req.query?.id || '');
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) return res.status(400).json({ error: 'A valid render id is required.' });

  const version = process.env.SHOTSTACK_ENV === 'v1' ? 'v1' : 'stage';
  try {
    const upstream = await fetch('https://api.shotstack.io/edit/' + version + '/render/' + encodeURIComponent(id) + '?data=false', {
      headers: { Accept: 'application/json', 'x-api-key': key }
    });
    const raw = await upstream.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data?.error || data?.message || 'Unable to read render status.' });
    }

    const r = data?.response || data;
    const state = String(r?.status || 'unknown').toLowerCase();
    const videoUrl = state === 'done' ? (r?.url || null) : null;
    const error = state === 'failed' ? (r?.error || 'Video rendering failed.') : null;

    try {
      const d = await init();
      await d.execute({
        sql: 'UPDATE generation_jobs SET status=?,result_url=?,error=? WHERE id=?',
        args: [state, videoUrl || '', error || '', id]
      });
    } catch {}

    return res.status(200).json({
      renderId: id,
      status: state,
      videoUrl,
      owner: r?.owner || null,
      error,
      updatedAt: r?.updated || null
    });
  } catch (error) {
    return res.status(502).json({ error: 'Could not connect to Shotstack: ' + error.message });
  }
}
