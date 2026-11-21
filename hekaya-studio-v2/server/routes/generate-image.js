import { requireAccess } from '../../api/_auth.js';
import { magicHourRequest } from '../../api/_magichour.js';
import { init } from '../../api/_db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!requireAccess(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > 8000) return res.status(400).json({ error: 'اكتب وصف الصورة (بحد أقصى 8000 حرف).' });
  const aspectRatio = ['1:1','16:9','9:16','4:3','3:4'].includes(body.aspectRatio) ? body.aspectRatio : '9:16';
  const model = process.env.MAGICHOUR_IMAGE_MODEL || 'z-image-turbo';

  try {
    const result = await magicHourRequest(req, '/v1/ai-image-generator', {
      name: String(body.name || 'Hekaya scene image').slice(0, 120),
      image_count: 1,
      style: { prompt, tool: 'general' },
      aspect_ratio: aspectRatio,
      model,
      resolution: process.env.MAGICHOUR_IMAGE_RESOLUTION || '1k'
    });
    const projectId = result?.id;
    if (!projectId) return res.status(502).json({ error: 'Magic Hour لم يُرجع معرّف مشروع الصورة.' });
    try {
      const db = await init(req);
      await db.execute({
        sql: 'INSERT INTO generation_jobs(id,project_id,scene_id,kind,model,prompt,status) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
        args: [projectId, typeof body.projectId === 'string' ? body.projectId : null, typeof body.sceneId === 'string' ? body.sceneId : null, 'image', model, prompt.slice(0, 2000), 'queued']
      });
    } catch {}
    return res.status(202).json({ provider: 'magichour', projectId, status: 'queued', model, creditsCharged: result.credits_charged || null });
  } catch (error) {
    return res.status(502).json({ error: error.message || 'فشل طلب توليد الصورة من Magic Hour.' });
  }
}
