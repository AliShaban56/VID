import { createClient } from '@libsql/client';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const COOKIE_NAME = 'hekaya_db_config';
const clients = new Map();

const schema = [
  'CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,title TEXT NOT NULL,story TEXT NOT NULL DEFAULT "",created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  'CREATE TABLE IF NOT EXISTS scenes(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,position INTEGER NOT NULL,text TEXT NOT NULL DEFAULT "",image_prompt TEXT NOT NULL DEFAULT "",video_prompt TEXT NOT NULL DEFAULT "",image_url TEXT NOT NULL DEFAULT "",video_url TEXT NOT NULL DEFAULT "",status TEXT NOT NULL DEFAULT "draft",created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  'CREATE TABLE IF NOT EXISTS generation_jobs(id TEXT PRIMARY KEY,project_id TEXT,scene_id TEXT,kind TEXT NOT NULL,model TEXT,prompt TEXT,status TEXT NOT NULL DEFAULT "pending",result_url TEXT,error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  'CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
];

function encryptionKey() {
  const secret = process.env.HEKAYA_SECRET_ENCRYPTION_KEY || process.env.APP_SESSION_SECRET || '';
  if (!secret) throw new Error('Database connection encryption is not configured.');
  return createHash('sha256').update(secret).digest();
}

function readCookie(req, name) {
  const raw = String(req?.headers?.cookie || '');
  const item = raw.split(';').map(value => value.trim()).find(value => value.startsWith(name + '='));
  if (!item) return '';
  try { return decodeURIComponent(item.slice(name.length + 1)); } catch { return ''; }
}

function encryptConfig(config) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function decryptConfig(value) {
  try {
    if (!value || value.length > 3500) return null;
    const data = Buffer.from(value, 'base64url');
    if (data.length < 29) return null;
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const decoded = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    const config = JSON.parse(decoded);
    if (typeof config.url !== 'string' || typeof config.authToken !== 'string' ||
        !config.url || !config.authToken) return null;
    return { url: config.url, authToken: config.authToken };
  } catch {
    return null;
  }
}

export function databaseConfig(req) {
  const browserConfig = decryptConfig(readCookie(req, COOKIE_NAME));
  if (browserConfig) return { ...browserConfig, source: 'browser' };

  const url = process.env.TURSO_DATABASE_URL || '';
  const authToken = process.env.TURSO_AUTH_TOKEN || '';
  if (url && authToken) return { url, authToken, source: 'environment' };
  return null;
}

function clientFor(config) {
  const cacheKey = createHash('sha256')
    .update(config.url)
    .update('\0')
    .update(config.authToken)
    .digest('hex');
  if (!clients.has(cacheKey)) {
    clients.set(cacheKey, createClient({ url: config.url, authToken: config.authToken }));
  }
  return clients.get(cacheKey);
}

export function db(req) {
  const config = databaseConfig(req);
  if (!config) throw new Error('قاعدة Turso غير مربوطة. أدخل Database URL وAuth Token في إعدادات قاعدة البيانات.');
  return clientFor(config);
}

async function initializeSchema(client) {
  await client.batch(schema, 'write');
  return client;
}

export async function init(req) {
  return initializeSchema(db(req));
}

export async function connectDatabase(url, authToken) {
  const client = clientFor({ url, authToken });
  await client.execute('SELECT 1 AS connection_test');
  await initializeSchema(client);
  return client;
}

export function setDatabaseCookie(res, url, authToken) {
  const value = encryptConfig({ url, authToken });
  if (value.length > 3500) throw new Error('بيانات الاتصال أكبر من الحد الآمن للمتصفح؛ استخدم متغيرات Vercel بدلًا من ذلك.');
  res.setHeader('Set-Cookie',
    COOKIE_NAME + '=' + encodeURIComponent(value) +
    '; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict');
}

export function clearDatabaseCookie(res) {
  res.setHeader('Set-Cookie',
    COOKIE_NAME + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
}
