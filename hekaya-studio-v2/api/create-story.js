import { requireAccess } from './_auth.js';
import { init } from './_db.js';

function parseJson(value) {
  if (typeof value !== 'string') throw new Error('The text model returned an empty response.');
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model response was not valid JSON.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

export default async function handler(req, res) {
  if (!requireAccess(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
  const model = process.env.AI_TEXT_MODEL || 'gpt-4o-mini';
  if (!apiKey) return res.status(503).json({ error: 'AI API is not configured. Add AI_API_KEY in Vercel Environment Variables.' });

  const body = req.body || {};
  const concept = text(body.concept || body.story);
  if (!concept) return res.status(400).json({ error: 'اكتب فكرة القصة أولاً.' });
  if (concept.length > 12000) return res.status(400).json({ error: 'الفكرة طويلة جدًا (الحد 12000 حرف).' });

  const language = text(body.language, 'Arabic');
  const genre = text(body.genre, 'دراما مشوقة');
  const audience = text(body.audience, 'عام');
  const duration = Math.max(30, Math.min(900, Number(body.durationSeconds) || 120));
  const visualStyle = text(body.visualStyle, 'سينمائي واقعي، اتساق بصري ثابت للشخصيات');
  const requestedSceneCount = Number(body.sceneCount) || Math.ceil(duration / 12);
  const sceneCount = Math.max(3, Math.min(30, Math.max(Math.ceil(duration / 15), requestedSceneCount)));

  const system = [
    'You are the head writer, showrunner, storyboard artist, and production planner for a professional AI video studio.',
    'Turn the user concept into a coherent, production-ready short film plan.',
    'Return ONLY one valid JSON object. No markdown and no commentary.',
    'All audience-facing text must be in the requested language.',
    'Keep character names, appearance, clothing, locations, and props consistent across every scene.',
    'Every scene must be directly actionable by image and video generation systems.',
    'Do not refer to previous scenes with vague phrases such as "same as before"; repeat the full visual continuity details needed in each prompt.',
    'Write detailed imagePrompt and videoPrompt in English for stronger compatibility with visual generation models, while title, story, narration, dialogue, and labels stay in the requested language.',
    'The videoPrompt must describe visible action, motion, camera movement, lighting, composition, and continuity; do not put spoken dialogue inside videoPrompt.',
    'Return the fields title, logline, story, characters, visualBible, soundtrackDirection, and scenes.',
    'Each scene needs: title, durationSeconds, narration, dialogue, imagePrompt, videoPrompt, camera, soundDesign, transition, and generationNotes.',
    'Total scene durations should approximately equal the requested total duration.'
  ].join(' ');

  const user = {
    task: 'Create a complete original story and a scene-by-scene production package through the final video.',
    concept,
    language,
    genre,
    audience,
    totalDurationSeconds: duration,
    requestedSceneCount: sceneCount,
    visualStyle,
    requiredJsonShape: {
      title: 'string',
      logline: 'string',
      story: 'string',
      characters: [{ name: 'string', visualDescription: 'string', voiceDescription: 'string' }],
      visualBible: 'string',
      soundtrackDirection: 'string',
      scenes: [{
        title: 'string', durationSeconds: 'number', narration: 'string', dialogue: 'string',
        imagePrompt: 'detailed English prompt for one keyframe',
        videoPrompt: 'detailed English prompt for animating this scene',
        camera: 'shot size, lens feel, camera movement',
        soundDesign: 'ambience, SFX, music cues',
        transition: 'transition to the next scene',
        generationNotes: 'continuity and production instructions'
      }]
    }
  };

  try {
    const upstream = await fetch(baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(user) }]
      })
    });
    const raw = await upstream.text();
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = { raw }; }
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: payload?.error?.message || payload?.message || 'The AI provider rejected the request.'
      });
    }

    let result = parseJson(payload?.choices?.[0]?.message?.content);
    if (!Array.isArray(result.scenes) || result.scenes.length === 0) {
      return res.status(502).json({ error: 'The AI model did not return any scenes.' });
    }

    result.title = text(result.title, 'قصة جديدة');
    result.logline = text(result.logline);
    result.story = text(result.story, concept);
    result.characters = Array.isArray(result.characters) ? result.characters : [];
    result.visualBible = text(result.visualBible);
    result.soundtrackDirection = text(result.soundtrackDirection);
    result.scenes = result.scenes.slice(0, 30).map((scene, index) => ({
      id: 'scene-' + (index + 1),
      position: index,
      title: text(scene.title, 'مشهد ' + (index + 1)),
      durationSeconds: Math.max(4, Math.min(15, Number(scene.durationSeconds) || Math.ceil(duration / Math.max(3, result.scenes.length)))),
      narration: text(scene.narration),
      dialogue: text(scene.dialogue),
      imagePrompt: text(scene.imagePrompt),
      videoPrompt: text(scene.videoPrompt),
      camera: text(scene.camera),
      soundDesign: text(scene.soundDesign),
      transition: text(scene.transition),
      generationNotes: text(scene.generationNotes)
    }));

    let database = { saved: false };
    if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
      try {
        const d = await init();
        const projectId = crypto.randomUUID();
        await d.execute({
          sql: 'INSERT INTO projects(id,title,story) VALUES(?,?,?)',
          args: [projectId, result.title, result.story]
        });
        for (const scene of result.scenes) {
          await d.execute({
            sql: 'INSERT INTO scenes(id,project_id,position,text,image_prompt,video_prompt,status) VALUES(?,?,?,?,?,?,?)',
            args: [
              projectId + '-scene-' + scene.position, projectId, scene.position,
              [scene.narration, scene.dialogue].filter(Boolean).join('\n'),
              scene.imagePrompt, scene.videoPrompt, 'script-ready'
            ]
          });
        }
        database = { saved: true, projectId };
      } catch (error) {
        database = { saved: false, warning: 'The story was generated, but database saving failed: ' + error.message };
      }
    } else {
      database.warning = 'Turso is not configured; the generated package is returned to the browser but is not yet persisted.';
    }

    return res.status(200).json({ ...result, database, model });
  } catch (error) {
    return res.status(502).json({ error: error.message || 'Story generation failed.' });
  }
}
