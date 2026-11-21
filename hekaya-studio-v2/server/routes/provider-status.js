import { db, databaseConfig } from '../../api/_db.js';
import { requireAccess } from '../../api/_auth.js';
import { handleMagicHourKeys, magicHourRequest, magicHourKeysConfigured } from '../../api/_magichour.js';

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
  const rendererUrl = process.env.HEKAYA_RENDERER_URL;
  const rendererToken = process.env.HEKAYA_RENDERER_TOKEN || '';

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

  const rendererPromise = rendererUrl
    ? probe(String(rendererUrl).replace(/\\/+$/, '') + '/health', { Accept: 'application/json', ...(rendererToken ? { Authorization: 'Bearer ' + rendererToken } : {}) }, 'محرك حكاية الداخلي')
    : Promise.resolve({ state: 'missing', detail: 'محرك FFmpeg الداخلي يحتاج HEKAYA_RENDERER_URL حتى يتم تشغيل التجميع.' });

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

  const [magicHour, renderer, database] = await Promise.all([
    magicHourPromise, rendererPromise, databasePromise
  ]);

  return {
    checkedAt: new Date().toISOString(),
    providers: [
      result('magichour', 'Magic Hour — الصور والفيديو والصوت والموسيقى', 'MAGICHOUR_API_KEY / الخزنة المشفرة', magicHour.state, magicHour.detail, {
        model: process.env.MAGICHOUR_IMAGE_MODEL || 'z-image-turbo',
        videoModel: process.env.MAGICHOUR_VIDEO_MODEL || 'ltx-2.5'
      }),
      result('assembly', 'محرك تجميع حكاية الداخلي (FFmpeg)', 'HEKAYA_RENDERER_URL + HEKAYA_RENDERER_TOKEN', renderer.state, renderer.detail, { model: 'محرك داخلي — لا يعتمد على Shotstack' }),
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
