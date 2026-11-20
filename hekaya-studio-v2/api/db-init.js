import { requireAccess } from './_auth.js';
import { init, connectDatabase, setDatabaseCookie, clearDatabaseCookie } from './_db.js';

function sameOrigin(req) {
  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

function validateConnection(urlValue, tokenValue) {
  const url = String(urlValue || '').trim();
  const authToken = String(tokenValue || '').trim();
  if (!url || url.length > 500 || authToken.length < 20 || authToken.length > 3000) {
    throw new Error('أدخل Database URL وAuth Token صالحين.');
  }
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('رابط قاعدة البيانات غير صحيح.'); }
  if (!['libsql:', 'https:'].includes(parsed.protocol) || !parsed.hostname ||
      parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('استخدم رابط Turso يبدأ بـ libsql:// أو رابط HTTPS آمن.');
  }
  return { url, authToken };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!requireAccess(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'طلب غير مسموح.' });

  const action = String(req.body?.action || 'initialize');

  if (action === 'disconnect') {
    clearDatabaseCookie(res);
    return res.status(200).json({
      ok: true,
      environmentConfigured: Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN),
      message: 'تم فصل اتصال قاعدة البيانات المحفوظ في هذا المتصفح.'
    });
  }

  if (action === 'connect') {
    try {
      const { url, authToken } = validateConnection(req.body?.databaseUrl, req.body?.authToken);
      await connectDatabase(url, authToken);
      setDatabaseCookie(res, url, authToken);
      return res.status(200).json({
        ok: true,
        connected: true,
        message: 'تم اختبار الاتصال بنجاح وإنشاء جداول حكاية.'
      });
    } catch (error) {
      const message = error?.message || '';
      const safeMessage = message.includes('أكبر من الحد الآمن') || message.includes('أدخل') ||
        message.includes('رابط') || message.includes('استخدم')
        ? message
        : 'فشل الاتصال بقاعدة البيانات. تأكد من Database URL وAuth Token وصلاحياتهما.';
      return res.status(400).json({ error: safeMessage });
    }
  }

  if (action !== 'initialize') return res.status(400).json({ error: 'إجراء غير معروف.' });

  try {
    await init(req);
    return res.status(200).json({ ok: true, message: 'تم تجهيز جداول قاعدة البيانات بنجاح.' });
  } catch {
    return res.status(503).json({
      error: 'قاعدة البيانات غير متصلة. أدخل Database URL وAuth Token ثم اضغط «اختبار وربط».'
    });
  }
}
