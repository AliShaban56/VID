import { requireAccess } from './_auth.js';
import { init } from './_db.js';
import { magicHourRequest } from './_magichour.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireAccess(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (req.query?.provider === 'magichour') {
    const type = String(req.query?.type || 'image');
    const id = String(req.query?.id || '');
    if (!['image', 'video', 'audio'].includes(type) || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) {
      return res.status(400).json({ error: 'بيانات مشروع Magic Hour غير صحيحة.' });
    }
    try {
      const details = await magicHourRequest(req, '/v1/' + type + '-projects/' + encodeURIComponent(id), undefined, 'GET');
      const state = String(details?.status || 'unknown').toLowerCase();
      const mediaUrl = details?.downloads?.[0]?.url || null;
      const error = details?.error?.message || details?.error || null;
      try {
          const db = await init(req);
          await db.execute({
            sql: 'UPDATE generation_jobs SET status=?,result_url=?,error=? WHERE id=?',
            args: [state, mediaUrl || '', error ? String(error) : '', id]
          });
        } catch {}
      return res.status(200).json({ provider: 'magichour', projectId: id, type, status: state, mediaUrl, downloads: details?.downloads || [], error });
    } catch (error) {
      return res.status(502).json({ error: error.message || 'تعذر جلب حالة مشروع Magic Hour.' });
    }
  }

  const key = process.env.SHOTSTACK_API_KEY;
  if (!key) return res.status(503).json({ error: 'أضف SHOTSTACK_API_KEY لتركيب الفيديو النهائي.' });
  const id = String(req.query?.id || '');
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) return res.status(400).json({ error: 'معرّف الرندر غير صحيح.' });
  const version = process.env.SHOTSTACK_ENV === 'v1' ? 'v1' : 'stage';
  try {
    const upstream = await fetch('https://api.shotstack.io/edit/' + version + '/render/' + encodeURIComponent(id) + '?data=false', {
      headers: { Accept: 'application/json', 'x-api-key': key },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store'
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return res.status(upstream.status).json({ error: data?.error || data?.message || 'تعذر قراءة حالة الفيديو.' });
    const result = data?.response || data;
    const state = String(result?.status || 'unknown').toLowerCase();
    const videoUrl = state === 'done' ? (result?.url || null) : null;
    const error = state === 'failed' ? (result?.error || 'فشل تركيب الفيديو.') : null;
    try {
      const db = await init(req);
      await db.execute({
        sql: 'UPDATE generation_jobs SET status=?,result_url=?,error=? WHERE id=?',
        args: [state, videoUrl || '', error || '', id]
      });
    } catch {}
    return res.status(200).json({ renderId: id, status: state, videoUrl, error, updatedAt: result?.updated || null });
  } catch (error) {
    return res.status(502).json({ error: 'تعذر الاتصال بمحرك تركيب الفيديو.' });
  }
}
