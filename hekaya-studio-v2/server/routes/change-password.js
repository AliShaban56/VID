import { requireAccess } from '../../api/_auth.js';
import { verifyStudioPassword, saveStudioPassword } from '../../api/_password.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAccess(req, res)) return;

  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return res.status(403).json({ error: 'طلب غير مسموح.' });
    } catch {
      return res.status(403).json({ error: 'طلب غير مسموح.' });
    }
  }

  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'أدخل كلمة المرور الحالية والجديدة.' });
  if (newPassword.length < 12 || newPassword.length > 128) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 12 حرفًا على الأقل ولا تتجاوز 128 حرفًا.' });
  }
  if (newPassword === currentPassword) return res.status(400).json({ error: 'اختر كلمة مرور مختلفة عن الحالية.' });

  try {
    if (!await verifyStudioPassword(currentPassword, req)) {
      return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
    }
    await saveStudioPassword(newPassword, req);
    return res.status(200).json({ ok: true, message: 'تم تحديث كلمة المرور. ستستخدمها في تسجيل الدخول القادم.' });
  } catch (error) {
    return res.status(503).json({ error: error.message || 'تعذر حفظ كلمة المرور.' });
  }
}
