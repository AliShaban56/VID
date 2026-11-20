import { requireAccess } from './_auth.js';
import { init } from './_db.js';

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

export default async function handler(req, res) {
  if (!requireAccess(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const key = process.env.SHOTSTACK_API_KEY;
  if (!key) return res.status(503).json({ error: 'Add SHOTSTACK_API_KEY to Vercel Environment Variables to enable final video production.' });

  const version = process.env.SHOTSTACK_ENV === 'v1' ? 'v1' : 'stage';
  const body = req.body || {};
  const pkg = body.productionPackage || body;
  if (!Array.isArray(pkg.scenes) || pkg.scenes.length === 0) {
    return res.status(400).json({ error: 'A production package with scenes is required.' });
  }
  if (pkg.scenes.length > 30) return res.status(400).json({ error: 'The current workflow supports up to 30 scenes per final render.' });

  const videoModel = String(body.videoModel || process.env.SHOTSTACK_VIDEO_MODEL || 'seedance-2.0-text-to-video');
  const speechModel = process.env.SHOTSTACK_TTS_MODEL || 'elevenlabs-multilingual-v2';
  const musicModel = process.env.SHOTSTACK_MUSIC_MODEL || 'elevenlabs-music';
  const aspectRatio = ['16:9','9:16','1:1','4:3','3:4','21:9'].includes(body.aspectRatio) ? body.aspectRatio : '16:9';
  const videoClips = [];
  const voiceClips = [];
  let cursor = 0;

  for (let i = 0; i < pkg.scenes.length; i++) {
    const scene = pkg.scenes[i] || {};
    const prompt = String(scene.videoPrompt || scene.imagePrompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Scene ' + (i + 1) + ' is missing its video prompt.' });

    const length = clamp(scene.durationSeconds, 4, 15, 8);
    const continuity = String(pkg.visualBible || '').trim();
    const fullPrompt = [
      prompt,
      continuity ? 'Visual continuity bible: ' + continuity : '',
      scene.soundDesign ? 'Sound design and ambient audio: ' + String(scene.soundDesign) : '',
      'Keep all people, costumes, props and locations visually consistent. Cinematic composition. No subtitles, no logos, no watermarks.'
    ].filter(Boolean).join('\n');

    videoClips.push({
      asset: {
        type: 'video',
        prompt: fullPrompt.slice(0, 8000),
        model: videoModel,
        options: {
          resolution: process.env.SHOTSTACK_VIDEO_RESOLUTION || '720p',
          aspectRatio,
          generateAudio: true
        }
      },
      start: cursor,
      length,
      transition: { in: i === 0 ? 'fade' : 'fade', out: 'fade' }
    });

    const spokenText = [scene.narration, scene.dialogue].map(value => String(value || '').trim()).filter(Boolean).join('\n');
    if (spokenText) {
      const audioAsset = {
        type: 'audio',
        prompt: spokenText.slice(0, 5000),
        model: speechModel
      };
      if (process.env.SHOTSTACK_TTS_VOICE) {
        audioAsset.options = { voice: process.env.SHOTSTACK_TTS_VOICE };
      }
      voiceClips.push({ asset: audioAsset, start: cursor + 0.15, length: 'auto', volume: 1 });
    }
    cursor += length;
  }

  const soundtrackPrompt = String(pkg.soundtrackDirection || 'Cinematic instrumental score, emotionally evolving, no vocals').slice(0, 2000);
  const musicClip = {
    asset: {
      type: 'audio',
      prompt: soundtrackPrompt,
      model: musicModel,
      options: { forceInstrumental: true }
    },
    start: 0,
    length: cursor,
    volume: 0.22,
    effect: 'fadeOut'
  };

  const edit = {
    timeline: {
      background: '#000000',
      tracks: [
        { clips: videoClips },
        ...(voiceClips.length ? [{ clips: voiceClips }] : []),
        { clips: [musicClip] }
      ]
    },
    output: {
      format: 'mp4',
      resolution: process.env.SHOTSTACK_OUTPUT_RESOLUTION || 'hd',
      aspectRatio,
      fps: 25,
      quality: 'high'
    }
  };

  try {
    const upstream = await fetch('https://api.shotstack.io/edit/' + version + '/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-api-key': key },
      body: JSON.stringify(edit)
    });
    const raw = await upstream.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data?.error || data?.message || data?.response?.message || 'Shotstack rejected the render request.',
        details: data
      });
    }

    const renderId = data?.response?.id || data?.id;
    if (!renderId) return res.status(502).json({ error: 'Shotstack did not return a render ID.', details: data });

    const projectId = typeof body.projectId === 'string' ? body.projectId : null;
    try {
      const d = await init();
      await d.execute({
        sql: 'INSERT INTO generation_jobs(id,project_id,kind,model,prompt,status) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status',
        args: [renderId, projectId, 'final-video', videoModel, String(pkg.title || 'Hekaya final video'), 'queued']
      });
    } catch {}

    return res.status(202).json({
      renderId,
      status: 'queued',
      version,
      videoModel,
      estimatedDurationSeconds: cursor,
      message: 'The final video render has been queued.'
    });
  } catch (error) {
    return res.status(502).json({ error: 'Could not connect to Shotstack: ' + error.message });
  }
}
