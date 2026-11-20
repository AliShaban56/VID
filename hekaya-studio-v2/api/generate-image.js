import { requireAccess } from './_auth.js';
export default async function handler(req, res) {
  if (!requireAccess(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.IMAGE_API_KEY || process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
    const baseUrl = (process.env.IMAGE_API_BASE_URL || process.env.AI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
  const endpoint = process.env.IMAGE_API_ENDPOINT || (baseUrl + '/v1/images/generations');
  const defaultModel = process.env.IMAGE_MODEL || 'gpt-image-1';
  if (!apiKey) return res.status(503).json({ error: 'Image API is not configured. Add IMAGE_API_KEY or AI_API_KEY in Vercel.' });

  const { prompt, model, size, quality } = req.body || {};
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) {
    return res.status(400).json({ error: 'Prompt required (max 8000 chars).' });
  }

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || defaultModel,
        prompt: prompt.trim(),
        size: size || '1024x1024',
        ...(quality ? { quality } : {})
      })
    });
    const raw = await upstream.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data?.error?.message || data?.message || 'Image provider returned an error.' });
    }
    const item = data?.data?.[0] || {};
    const imageUrl = item.url || data?.image_url || data?.url;
    const imageData = item.b64_json ? 'data:image/png;base64,' + item.b64_json : null;
    if (!imageUrl && !imageData) {
      return res.status(502).json({ error: 'Provider response did not include an image URL or base64 image.' });
    }
    return res.status(200).json({ imageUrl: imageUrl || imageData, model: model || defaultModel });
  } catch (error) {
    return res.status(502).json({ error: 'Image provider connection failed: ' + error.message });
  }
}
