import { db } from './_db.js';

let lastSnapshot = null;
let lastCheckedAt = 0;
let pendingCheck = null;

function result(id, label, env, state, detail, extra = {}) {
  return { id, label, env, state, detail, ...extra };
}

function explainHttp(status, provider) {
  if (status === 401 || status === 403) return provider + ': المفتاح مرفوض أو غير صحيح أو لا يملك صلاحية.';
  if (status === 404) return provider + ': عنوان API أو مسار الفحص غير موجود.';
  if (status === 429) return provider + ': المفتاح معروف لكن يوجد حد استخدام أو رصيد/حصة غير متاح حاليًا.';
  if (status >= 500) return provider + ': الخدمة نفسها تواجه مشكلة مؤقتة.';
  return provider + ': فشل اختبار الاتصال (HTTP ' + status + ').';
}

async function probe(url, headers, label) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
      cache: 'no-store'
    });
    if (response.ok) {
      return { state: 'ok', detail: 'تم قبول المفتاح والاتصال بالمزود بنجاح.' };
    }
    return { state: 'error', detail: explainHttp(response.status, label) };
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return {
      state: 'error',
      detail: timeout ? label + ': انتهت مهلة الاتصال.' : label + ': تعذر الوصول إلى الخدمة أو عنوان API.'
    };
  }
}

async function collectStatus() {
  const aiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  const aiBase = (process.env.AI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
  const imageKey = process.env.IMAGE_API_KEY || aiKey;
  const imageBase = (process.env.IMAGE_API_BASE_URL || process.env.AI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
  const shotstackKey = process.env.SHOTSTACK_API_KEY;
  const shotstackEnv = process.env.SHOTSTACK_ENV === 'v1' ? 'v1' : 'stage';
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  const aiPromise = aiKey
    ? probe(aiBase + '/v1/models', { Authorization: 'Bearer ' + aiKey, Accept: 'application/json' }, 'محرك كتابة القصص')
    : Promise.resolve({ state: 'missing', detail: 'لم تتم إضافة مفتاح كتابة القصص بعد.' });

  const imageUsesAi = Boolean(imageKey && imageKey === aiKey && imageBase === aiBase);
  const imagePromise = !imageKey
    ? Promise.resolve({ state: 'missing', detail: 'لم تتم إضافة مفتاح الصور بعد.' })
    : imageUsesAi
      ? aiPromise
      : probe(imageBase + '/v1/models', { Authorization: 'Bearer ' + imageKey, Accept: 'application/json' }, 'محرك الصور');

  const shotstackPromise = shotstackKey
    ? probe('https://api.shotstack.io/edit/' + shotstackEnv + '/models', { 'x-api-key': shotstackKey, Accept: 'application/json' }, 'Shotstack')
    : Promise.resolve({ state: 'missing', detail: 'لم تتم إضافة مفتاح Shotstack بعد.' });

  const databasePromise = !tursoUrl && !tursoToken
    ? Promise.resolve({ state: 'missing', detail: 'قاعدة Turso غير مربوطة بعد.' })
    : !tursoUrl || !tursoToken
      ? Promise.resolve({ state: 'error', detail: 'إعداد Turso غير مكتمل؛ يلزم الرابط والمفتاح معًا.' })
      : (async () => {
          try {
            const client = db();
            await client.execute('SELECT 1 AS connection_test');
            return { state: 'ok', detail: 'تم الاتصال بقاعدة Turso بنجاح.' };
          } catch {
            return { state: 'error', detail: 'تعذر الاتصال بقاعدة Turso؛ راجع الرابط وصلاحية Auth Token.' };
          }
        })();

  const [ai, image, shotstack, database] = await Promise.all([
    aiPromise, imagePromise, shotstackPromise, databasePromise
  ]);

  const sharedNote = imageUsesAi ? 'يستخدم نفس مفتاح محرك القصص.' : 'مفتاح مستقل للصور.';
  return {
    checkedAt: new Date().toISOString(),
    providers: [
      result('story', 'محرك كتابة القصص', 'AI_API_KEY أو OPENAI_API_KEY', ai.state, ai.detail, { model: process.env.AI_TEXT_MODEL || 'gpt-4o-mini' }),
      result('image', 'محرك توليد الصور', imageUsesAi ? 'AI_API_KEY (مشترك)' : 'IMAGE_API_KEY', image.state, image.detail, { model: process.env.IMAGE_MODEL || 'gpt-image-1', note: sharedNote }),
      result('video', 'الفيديو والصوت والموسيقى', 'SHOTSTACK_API_KEY', shotstack.state, shotstack.detail, {
        environment: shotstackEnv === 'stage' ? 'تجريبي Stage' : 'إنتاج V1',
        videoModel: process.env.SHOTSTACK_VIDEO_MODEL || 'seedance-2.0-text-to-video',
        speechModel: process.env.SHOTSTACK_TTS_MODEL || 'elevenlabs-multilingual-v2',
        musicModel: process.env.SHOTSTACK_MUSIC_MODEL || 'elevenlabs-music'
      }),
      result('database', 'قاعدة البيانات Turso', 'TURSO_DATABASE_URL + TURSO_AUTH_TOKEN', database.state, database.detail)
    ],
    note: 'اختبار الاتصال يتحقق من قبول المفتاح أو اتصال قاعدة البيانات، ولا ينفذ توليد صورة أو فيديو مدفوعًا.'
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (lastSnapshot && Date.now() - lastCheckedAt < 30000) {
    return res.status(200).json(lastSnapshot);
  }
  if (!pendingCheck) {
    pendingCheck = collectStatus().then(snapshot => {
      lastSnapshot = snapshot;
      lastCheckedAt = Date.now();
      return snapshot;
    }).finally(() => { pendingCheck = null; });
  }
  try {
    return res.status(200).json(await pendingCheck);
  } catch {
    return res.status(500).json({ error: 'تعذر فحص خدمات المنصة حاليًا.' });
  }
}
