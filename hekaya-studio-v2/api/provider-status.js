import { db, databaseConfig } from './_db.js';
import { requireAccess } from './_auth.js';
import { handleMagicHourKeys, magicHourRequest, magicHourKeysConfigured } from './_magichour.js';

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
    if (response.ok) return { state: 'ok', detail: 'تم قبول المفتاح والاتصال بالمزود بنجاح.' };
    return { state: 'error', detail: explainHttp(response.status, label) };
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return {
      state: 'error',
      detail: timeout ? label + ': انتهت مهلة الاتصال.' : label + ': تعذر الوصول إلى الخدمة أو عنوان API.'
    };
  }
}

async function collectStatus(req) {
  const aiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  const aiBase = (process.env.AI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
  const shotstackKey = process.env.SHOTSTACK_API_KEY;
  const shotstackEnv = process.env.SHOTSTACK_ENV === 'v1' ? 'v1' : 'stage';

  const magicHourPromise = (async () => {
    try {
      if (!await magicHourKeysConfigured(req)) {
        return { state: 'missing', detail: 'أضف مفتاح Magic Hour في الخزنة أو متغيرات Vercel.' };
      }
      await magicHourRequest(req, '/v1/voices', undefined, 'GET');
      return { state: 'ok', detail: 'Magic Hour قبل المفتاح؛ جاهز لطلبات الصور والفيديو والصوت.' };
    } catch (error) {
      return { state: 'error', detail: error?.message || 'تعذر الاتصال بـ Magic Hour.' };
    }
  })();

  const aiPromise = aiKey
    ? probe(aiBase + '/v1/models', { Authorization: 'Bearer ' + aiKey, Accept: 'application/json' }, 'محرك كتابة القصص')
    : Promise.resolve({ state: 'missing', detail: 'لم تتم إضافة مفتاح كتابة القصص بعد.' });

  const shotstackPromise = shotstackKey
    ? probe('https://api.shotstack.io/edit/' + shotstackEnv + '/models', { 'x-api-key': shotstackKey, Accept: 'application/json' }, 'Shotstack')
    : Promise.resolve({ state: 'missing', detail: 'يلزم Shotstack لتجميع ملفات الوسائط في MP4 نهائي.' });

  const databasePromise = (async () => {
    const config = databaseConfig(req);
    if (!config) return { state: 'missing', detail: 'أضف Database URL وAuth Token لربط Turso.' };
    try {
      await db(req).execute('SELECT 1 AS connection_test');
      return {
        state: 'ok',
        detail: config.source === 'environment'
          ? 'قاعدة Turso متصلة من إعدادات الخادم.'
          : 'قاعدة Turso متصلة من إعدادات الربط المشفرة لهذا المتصفح.'
      };
    } catch {
      return { state: 'error', detail: 'تعذر الاتصال بقاعدة Turso؛ راجع الرابط وصلاحية Auth Token.' };
    }
  })();

  const [ai, magicHour, shotstack, database] = await Promise.all([
    aiPromise, magicHourPromise, shotstackPromise, databasePromise
  ]);

  return {
    checkedAt: new Date().toISOString(),
    providers: [
      result('story', 'محرك كتابة القصص', 'AI_API_KEY أو OPENAI_API_KEY', ai.state, ai.detail, { model: process.env.AI_TEXT_MODEL || 'gpt-4o-mini' }),
      result('magichour', 'Magic Hour — الصور والفيديو والصوت والموسيقى', 'MAGICHOUR_API_KEY / الخزنة المشفرة', magicHour.state, magicHour.detail, {
        model: process.env.MAGICHOUR_IMAGE_MODEL || 'z-image-turbo',
        videoModel: process.env.MAGICHOUR_VIDEO_MODEL || 'ltx-2.5'
      }),
      result('assembly', 'تجميع MP4 النهائي', 'SHOTSTACK_API_KEY', shotstack.state, shotstack.detail, {
        environment: shotstackEnv === 'stage' ? 'تجريبي Stage' : 'إنتاج V1',
        model: 'تركيب فقط — لا يولّد وسائط'
      }),
      result('database', 'قاعدة البيانات Turso', 'TURSO_DATABASE_URL + TURSO_AUTH_TOKEN', database.state, database.detail)
    ],
    note: 'اختبار الاتصال يتحقق من قبول المفتاح أو اتصال قاعدة البيانات، ولا ينفذ توليد صورة أو فيديو مدفوعًا.'
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireAccess(req, res)) return;
  if (req.query?.resource === 'magichour-keys') return handleMagicHourKeys(req, res);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    return res.status(200).json(await collectStatus(req));
  } catch {
    return res.status(500).json({ error: 'تعذر فحص خدمات المنصة حاليًا.' });
  }
}
