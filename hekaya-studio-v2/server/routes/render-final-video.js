import { requireAccess } from '../api/_auth.js';
import { init } from '../api/_db.js';
import { magicHourRequest } from '../api/_magichour.js';

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const safeText = (value, max = 5000) => String(value || '').trim().slice(0, max);

async function saveJob(req, id, projectId, sceneId, kind, model, prompt) {
  try {
    const db = await init(req);
    await db.execute({
      sql: 'INSERT INTO generation_jobs(id,project_id,scene_id,kind,model,prompt,status) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
      args: [id, projectId || null, sceneId || null, kind, model || 'Magic Hour', safeText(prompt, 2000), 'queued']
    });
  } catch {}
}

async function submitAssembly(req, body, res) {
  const renderer = String(process.env.HEKAYA_RENDERER_URL || '').replace(/\\/+$/, '');
  const token = process.env.HEKAYA_RENDERER_TOKEN || '';
  if (!renderer) return res.status(503).json({ error: 'محرك حكاية المستقل غير مُثبت بعد. يلزم إعداد HEKAYA_RENDERER_URL لمحرك FFmpeg الخاص بحكاية.' });
  const assets = body.assets || {};
  const videos = Array.isArray(assets.videos) ? assets.videos.slice().sort((a,b)=>Number(a.sceneIndex)-Number(b.sceneIndex)) : [];
  if (!videos.length || videos.some(item => !/^https:\\/\\//i.test(item.url || ''))) return res.status(400).json({ error: 'لا توجد فيديوهات مشاهد جاهزة وصالحة للتركيب.' });
  const voices = Array.isArray(assets.voices) ? assets.voices.filter(item => /^https:\\/\\//i.test(item.url || '')) : [];
  const music = assets.music && /^https:\\/\\//i.test(assets.music.url || '') ? assets.music : null;
  const payload = { projectId: body.projectId || null, aspectRatio: ['16:9','9:16','1:1'].includes(body.aspectRatio) ? body.aspectRatio : '9:16', videos, voices, music, outputFormat: 'mp4' };
  try {
    const upstream = await fetch(renderer + '/render', { method:'POST', headers:{ 'Content-Type':'application/json', Accept:'application/json', ...(token ? { Authorization:'Bearer '+token } : {}) }, body:JSON.stringify(payload), signal:AbortSignal.timeout(30000) });
    const data = await upstream.json().catch(()=>({}));
    if (!upstream.ok) return res.status(upstream.status).json({ error:data?.error || data?.message || 'محرك التجميع الداخلي رفض الطلب.' });
    const renderId = data.renderId || data.id;
    if (!renderId) return res.status(502).json({ error:'محرك حكاية لم يرجع معرّف مهمة التجميع.' });
    await saveJob(req, renderId, body.projectId, null, 'final-video', 'Hekaya FFmpeg renderer', 'Internal Hekaya render');
    return res.status(202).json({ renderId, status:data.status || 'queued', provider:'hekaya-renderer' });
  } catch(error) { return res.status(502).json({ error:'تعذر الاتصال بمحرك حكاية الداخلي: '+error.message }); }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!requireAccess(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  if (body.action === 'assemble') return submitAssembly(req, body, res);

  const pkg = body.productionPackage || body;
  if (!Array.isArray(pkg.scenes) || !pkg.scenes.length) return res.status(400).json({ error: 'حزمة الإنتاج يجب أن تحتوي على مشاهد.' });
  if (pkg.scenes.length > 30) return res.status(400).json({ error: 'الحد الأقصى 30 مشهدًا.' });

  const videoModel = process.env.MAGICHOUR_VIDEO_MODEL || 'ltx-2.5';
  const imageRatio = ['16:9','9:16','1:1'].includes(body.aspectRatio) ? body.aspectRatio : '9:16';
  const voiceModel = 'ai-voice-generator';
  const musicModel = 'ai-music-generator';
  const projects = [];
  const warnings = [];
  let voiceId = process.env.MAGICHOUR_VOICE_ID || '';

  try {
    const needsVoice = pkg.scenes.some(scene => safeText(scene.narration + ' ' + scene.dialogue, 5000));
    if (needsVoice && !voiceId) {
      const voiceList = await magicHourRequest(req, '/v1/voices', undefined, 'GET');
      voiceId = voiceList?.voices?.[0]?.id || '';
      if (!voiceId) warnings.push('لم يرجع دليل الأصوات صوتًا افتراضيًا؛ تخطينا التعليق الصوتي.');
    }

    let timelineStart = 0;
    for (let index = 0; index < pkg.scenes.length; index++) {
      const scene = pkg.scenes[index] || {};
      const duration = clamp(scene.durationSeconds, 1, 60, 8);
      const visualPrompt = [
        safeText(scene.videoPrompt || scene.imagePrompt, 6000),
        safeText(pkg.visualBible, 1500) ? 'Character and visual continuity: ' + safeText(pkg.visualBible, 1500) : '',
        'Cinematic storytelling shot. Keep character appearance, clothing, props and environment consistent. No captions, logos, or watermarks.'
      ].filter(Boolean).join('\n');
      if (!visualPrompt.trim()) return res.status(400).json({ error: 'المشهد ' + (index + 1) + ' لا يحتوي على وصف بصري.' });
      const video = await magicHourRequest(req, '/v1/text-to-video', {
        name: safeText(pkg.title || 'Hekaya', 80) + ' scene ' + (index + 1),
        end_seconds: duration,
        style: { prompt: visualPrompt.slice(0, 3900) },
        aspect_ratio: imageRatio,
        model: videoModel,
        resolution: process.env.MAGICHOUR_VIDEO_RESOLUTION || '480p',
        audio: false
      });
      if (!video?.id) throw new Error('Magic Hour لم يرجع معرّف فيديو للمشهد ' + (index + 1) + '.');
      projects.push({ id: video.id, type: 'video', sceneIndex: index, start: timelineStart, durationSeconds: duration });
      await saveJob(req, video.id, body.projectId, pkg.scenes[index]?.id, 'video', videoModel, visualPrompt);

      const spoken = [scene.narration, scene.dialogue].map(value => safeText(value, 5000)).filter(Boolean).join('\n');
      if (spoken && voiceId) {
        const voice = await magicHourRequest(req, '/v1/ai-voice-generator', {
          name: safeText(pkg.title || 'Hekaya', 80) + ' voice ' + (index + 1),
          style: { prompt: spoken.slice(0, 5000), voice_name: voiceId, language: 'arabic', speed: 1 }
        });
        if (voice?.id) {
          projects.push({ id: voice.id, type: 'audio', audioRole: 'voice', sceneIndex: index, start: timelineStart });
          await saveJob(req, voice.id, body.projectId, pkg.scenes[index]?.id, 'audio', voiceModel, spoken);
        }
      }
      timelineStart += duration;
    }

    const soundtrack = safeText(pkg.soundtrackDirection || 'Instrumental cinematic score, warm emotional arc, subtle oud and strings, no vocals', 1800);
    const music = await magicHourRequest(req, '/v1/ai-music-generator', {
      name: safeText(pkg.title || 'Hekaya', 80) + ' soundtrack',
      duration: clamp(timelineStart, 15, 300, 60),
      style: { prompt: soundtrack, instrumental: true }
    });
    if (!music?.id) throw new Error('Magic Hour لم يرجع معرّف الموسيقى.');
    projects.push({ id: music.id, type: 'audio', audioRole: 'music', start: 0 });
    await saveJob(req, music.id, body.projectId, null, 'audio', musicModel, soundtrack);

    return res.status(202).json({
      provider: 'magichour',
      status: 'queued',
      projects,
      warnings,
      videoModel,
      voiceModel,
      musicModel,
      estimatedDurationSeconds: timelineStart
    });
  } catch (error) {
    return res.status(502).json({
      error: error.message || 'فشل إرسال مشروعات Magic Hour.',
      partial: projects.length > 0,
      projects,
      warnings
    });
  }
}
