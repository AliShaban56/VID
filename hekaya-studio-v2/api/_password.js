import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { init, databaseConfig } from './_db.js';

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return 'scrypt$' + salt.toString('base64url') + '$' + derived.toString('base64url');
}

function verifyHash(password, encoded) {
  const [scheme, saltText, hashText] = String(encoded || '').split('$');
  if (scheme !== 'scrypt' || !saltText || !hashText) return false;
  try {
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    const actual = scryptSync(password, salt, expected.length);
    return expected.length > 0 && actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export async function verifyStudioPassword(password, req) {
  const supplied = String(password || '');
  if (!supplied || !process.env.APP_ACCESS_PASSWORD) return false;

  if (databaseConfig(req)) {
    const d = await init(req);
    const result = await d.execute({
      sql: 'SELECT value FROM settings WHERE id=?',
      args: ['auth_password_hash']
    });
    const stored = result.rows?.[0]?.value;
    if (stored) return verifyHash(supplied, stored);
  }

  return safeEqual(supplied, process.env.APP_ACCESS_PASSWORD);
}

export async function saveStudioPassword(password, req) {
  if (!databaseConfig(req)) {
    throw new Error('اربط قاعدة Turso أولاً من صفحة المحركات والاتصال قبل تغيير كلمة المرور.');
  }
  const d = await init(req);
  const encoded = hashPassword(password);
  await d.execute({
    sql: 'INSERT INTO settings(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP',
    args: ['auth_password_hash', encoded]
  });
}
