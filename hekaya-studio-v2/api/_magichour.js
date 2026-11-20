import { init } from './_db.js';
import { createHash, createDecipheriv, createCipheriv, randomBytes } from 'node:crypto';

const encryptionSecret = () => process.env.HEKAYA_SECRET_ENCRYPTION_KEY || '';

function deriveKey() {
  const secret = encryptionSecret();
  if (!secret) throw new Error('HEKAYA_SECRET_ENCRYPTION_KEY is not configured.');
  return createHash('sha256').update(secret).digest();
}

function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

function decrypt(value) {
  const [iv, tag, data] = String(value).split('.');
  if (!iv || !tag || !data) throw new Error('Invalid encrypted Magic Hour key record.');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

async function storedKeys() {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN || !encryptionSecret()) return [];
  const database = await init();
  const row = await database.execute("SELECT value FROM settings WHERE id='magichour_keys'");
  let parsed = [];
  try {
    parsed = JSON.parse(row.rows?.[0]?.value || '[]');
  } catch {
    parsed = [];
  }
  return parsed.map(value => {
    try { return decrypt(value); } catch { return ''; }
  }).filter(Boolean);
}

async function keys() {
  const envKeys = [process.env.MAGICHOUR_API_KEYS, process.env.MAGICHOUR_API_KEY]
    .filter(Boolean)
    .flatMap(value => value.split(',').flatMap(part => part.split(';')).flatMap(part => part.split(String.fromCharCode(10))))
    .map(value => value.trim())
    .filter(Boolean);

  let databaseKeys = [];
  try { databaseKeys = await storedKeys(); } catch {}
  return [...new Set([...envKeys, ...databaseKeys])];
}

export async function magicHourRequest(path, body, method = 'POST') {
  const segments = typeof path === 'string' ? path.split('/') : [];
  if (segments.length < 3 || segments[0] !== '' || segments[1] !== 'v1' ||
      segments.slice(2).some(part => !part || !/^[a-zA-Z0-9_-]+$/.test(part))) {
    throw new Error('Invalid Magic Hour API path.');
  }

  const apiKeys = await keys();
  if (!apiKeys.length) throw new Error('أضف مفتاح Magic Hour في خزنة المحركات أولًا.');

  let lastError;
  for (const apiKey of apiKeys) {
    let response;
    try {
      response = await fetch('https://api.magichour.ai' + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000),
        cache: 'no-store'
      });
    } catch (error) {
      lastError = new Error('تعذر الاتصال بمفتاح Magic Hour الحالي: ' +
        (error?.name === 'TimeoutError' ? 'انتهت مهلة الاتصال.' : 'خطأ شبكة.'));
      continue;
    }

    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw.slice(0, 500) }; }
    if (response.ok) return data;

    const message = data?.error?.message || data?.message || ('Magic Hour HTTP ' + response.status);
    lastError = new Error(message);

    // Try the next key for auth failures, exhausted credits/rate limits, timeouts and provider outages.
    if ([401, 403, 402, 408, 429].includes(response.status) || response.status >= 500) continue;
    break;
  }

  throw lastError || new Error('فشل طلب Magic Hour.');
}

export async function magicHourKeysConfigured() {
  return (await keys()).length > 0;
}

export async function handleMagicHourKeys(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!encryptionSecret()) return res.status(503).json({ error: 'أضف HEKAYA_SECRET_ENCRYPTION_KEY إلى Vercel أولًا.' });
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    return res.status(503).json({ error: 'خزنة المفاتيح تحتاج تفعيل قاعدة Turso: TURSO_DATABASE_URL وTURSO_AUTH_TOKEN.' });
  }

  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (req.method === 'POST' && origin && host) {
    try {
      if (new URL(origin).host !== host) return res.status(403).json({ error: 'طلب غير مسموح.' });
    } catch {
      return res.status(403).json({ error: 'طلب غير مسموح.' });
    }
  }

  try {
    const database = await init();
    const row = await database.execute("SELECT value FROM settings WHERE id='magichour_keys'");
    const encrypted = JSON.parse(row.rows?.[0]?.value || '[]');
    const values = encrypted.map(decrypt);

    if (req.method === 'GET') {
      return res.status(200).json({
        count: values.length,
        keys: values.map((value, index) => ({
          index,
          label: 'Magic Hour key ' + (index + 1),
          masked: '••••' + value.slice(-4)
        }))
      });
    }

    const action = req.body?.action;
    if (action === 'add') {
      const key = String(req.body?.key || '').trim();
      if (key.length < 12 || key.length > 500) return res.status(400).json({ error: 'صيغة المفتاح غير صحيحة.' });
      if (values.includes(key)) return res.status(400).json({ error: 'المفتاح محفوظ بالفعل.' });
      if (values.length >= 10) return res.status(400).json({ error: 'يمكن حفظ 10 مفاتيح كحد أقصى.' });
      values.push(key);
    } else if (action === 'remove') {
      const index = Number(req.body?.index);
      if (!Number.isInteger(index) || index < 0 || index >= values.length) return res.status(400).json({ error: 'رقم المفتاح غير صحيح.' });
      values.splice(index, 1);
    } else if (action === 'replace') {
      const index = Number(req.body?.index);
      const key = String(req.body?.key || '').trim();
      if (!Number.isInteger(index) || index < 0 || index >= values.length || key.length < 12 || key.length > 500) {
        return res.status(400).json({ error: 'بيانات الاستبدال غير صحيحة.' });
      }
      values[index] = key;
    } else {
      return res.status(400).json({ error: 'إجراء غير معروف.' });
    }

    await database.execute({
      sql: "INSERT INTO settings(id,value,updated_at) VALUES('magichour_keys',?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP",
      args: [JSON.stringify(values.map(encrypt))]
    });

    return res.status(200).json({ saved: true, count: values.length });
  } catch (error) {
    return res.status(500).json({ error: 'تعذر حفظ المفاتيح المشفرة: ' + (error?.message || 'خطأ غير معروف') });
  }
}
