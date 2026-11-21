import { requireAccess } from '../api/_auth.js';
import { init, connectDatabase, setDatabaseCookie, clearDatabaseCookie } from '../api/_db.js';

function sameOrigin(req) {
  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

function safeConnectionError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '');
  const combined = code + ' ' + message;

  if (/AUTH|TOKEN|UNAUTHORIZED|401|403|FORBIDDEN|NOT_AUTHORIZED/.test(combined)) {
    return 'Turso رفض رمز الدخول. أنشئ Auth Token جديدًا بصلاحية قراءة وكتابة، ثم جرّب مرة أخرى.';
  }
  if (/URL_SCHEME|URL_INVALID|INVALID_URL|SCHEME|MALFORMED_URL/.test(combined)) {
    return 'رابط قاعدة البيانات غير مقبول. انسخ Database URL من Turso كما هو، ويجب أن يبدأ بـ libsql://.';
  }
  if (/ENOTFOUND|ECONN|TIMEOUT|FETCH_FAILED|NETWORK|TLS|CERTIFICATE/.test(combined)) {
    return 'تعذر الوصول إلى خادم Turso. راجع الرابط واتصال الإنترنت وحاول مرة أخرى.';
  }
  if (/PERMISSION|READ_ONLY|SQLITE_AUTH/.test(combined)) {
    return 'الرمز متصل لكنه لا يملك صلاحية الكتابة. أنشئ Auth Token بصلاحية قراءة وكتابة.';
  }
  if (/COOKIE|أكبر من الحد الآمن/.test(combined)) {
    return 'بيانات الاتصال أطول من الحد المسموح لحفظها بأمان في المتصفح.';
  }
  return 'لم يكتمل الاتصال بقاعدة Turso. راجع Database URL وAuth Token وتأكد من أن الرمز لم تنتهِ صلاحيته.';
}

function validateConnection(urlValue, tokenValue) {
  const url = String(urlValue || '').trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
  const authToken = String(tokenValue || '').trim().replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '');
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
      return res.status(400).json({ error: safeConnectionError(error) });
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
