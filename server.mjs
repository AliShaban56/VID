import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createHmac, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@libsql/client";
import mcpHandler from "./api/mcp.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const kieKeysFile = path.join(root, ".kie-keys.json");

async function loadEnv() {
  try {
    const content = await readFile(path.join(root, ".env"), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {}
}

await loadEnv();
const isVercelDeployment = process.env.APP_DEPLOYMENT_TARGET === "vercel" || process.env.VERCEL === "1" || Boolean(process.env.APP_ACCESS_PASSWORD);
let databaseUrl = process.env.TURSO_DATABASE_URL || "";
let authToken = process.env.TURSO_AUTH_TOKEN || "";
let usingLocalDb = !databaseUrl || !authToken;
let configIncomplete = Boolean(databaseUrl) !== Boolean(authToken);
let db = usingLocalDb && isVercelDeployment ? null : createClient(usingLocalDb
  ? { url: `file:${path.join(root, "hekaya-local.db")}` }
  : { url: databaseUrl, authToken });
let kieKeys = [];
let kieKeyCursor = 0;
const kieCooldowns = new Map();
const kieInvalidKeys = new Set();

async function loadKieKeys() {
  if (isVercelDeployment && db && !usingLocalDb) {
    try {
      const stored = await db.execute("SELECT id, label, secret FROM kie_api_keys ORDER BY created_at ASC");
      if (stored.rows.length > 0) {
        kieKeys = stored.rows.map((row) => ({ id: row.id, label: row.label, secret: row.secret }));
        return;
      }
    } catch {}
  }
  if (isVercelDeployment && process.env.KIE_API_KEYS) {
    try {
      const parsed = JSON.parse(process.env.KIE_API_KEYS);
      kieKeys = Array.isArray(parsed) ? parsed.map((item, index) => typeof item === "string"
        ? { id: `env-${index + 1}`, label: `مفتاح ${index + 1}`, secret: item.trim() }
        : item).filter((item) => item && typeof item.secret === "string" && item.secret.trim()) : [];
      return;
    } catch { kieKeys = []; return; }
  }
  if (isVercelDeployment) { kieKeys = []; return; }
  try {
    const parsed = JSON.parse(await readFile(kieKeysFile, "utf8"));
    kieKeys = Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === "string" && typeof item.secret === "string") : [];
  } catch { kieKeys = []; }
}

if (!isVercelDeployment) await loadKieKeys();

async function saveKieKeys() {
  if (isVercelDeployment && db && !usingLocalDb) {
    const statements = [{ sql: "DELETE FROM kie_api_keys" }, ...kieKeys.map((item) => ({
      sql: "INSERT INTO kie_api_keys (id, label, secret, created_at) VALUES (?, ?, ?, ?)",
      args: [item.id, item.label, item.secret, new Date().toISOString()],
    }))];
    await db.batch(statements, "write");
    return;
  }
  await writeFile(kieKeysFile, JSON.stringify(kieKeys, null, 2), { encoding: "utf8", mode: 0o600 });
}

function publicKieKeys() {
  const now = Date.now();
  return kieKeys.map((item) => ({
    id: item.id,
    label: item.label,
    masked: `••••${item.secret.slice(-4)}`,
    status: kieInvalidKeys.has(item.id) ? "invalid" : (kieCooldowns.get(item.id) > now ? "cooldown" : "ready"),
    retryIn: Math.max(0, Math.ceil(((kieCooldowns.get(item.id) || 0) - now) / 1000)),
  }));
}

async function kieRequest(pathname, payload) {
  if (!kieKeys.length) throw Object.assign(new Error("أضف مفتاح Kie.ai واحدًا على الأقل من الإعدادات."), { status: 409 });
  const start = kieKeyCursor % kieKeys.length;
  const ordered = kieKeys.map((_, index) => kieKeys[(start + index) % kieKeys.length]);
  const usable = ordered.filter((item) => !kieInvalidKeys.has(item.id));
  if (!usable.length) throw Object.assign(new Error("كل المفاتيح رُفضت من Kie.ai؛ راجع المفاتيح المحفوظة."), { status: 401 });
  const active = usable.filter((item) => (kieCooldowns.get(item.id) || 0) <= Date.now());
  if (!active.length) throw Object.assign(new Error("كل المفاتيح في مهلة مؤقتة بسبب حد الاستخدام؛ أعد المحاولة بعد قليل."), { status: 429 });
  let lastCode = 502;
  let lastMessage = "تعذر الاتصال بخدمة Kie.ai.";
  for (const item of active) {
    let response;
    let result;
    try {
      response = await fetch(`https://api.kie.ai${pathname}`, {
        method: payload === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${item.secret}`, "Content-Type": "application/json" },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      result = await response.json();
    } catch {
      throw Object.assign(new Error("تعذر الوصول إلى Kie.ai. لم نكرر الطلب لتجنب إنشاء مهمة مكررة."), { status: 502 });
    }
    const code = Number(result?.code ?? response.status);
    if (response.ok && code === 200) {
      kieKeyCursor = (kieKeys.findIndex((candidate) => candidate.id === item.id) + 1) % kieKeys.length;
      kieInvalidKeys.delete(item.id);
      kieCooldowns.delete(item.id);
      return { result, keyId: item.id };
    }
    lastCode = code;
    lastMessage = typeof result?.msg === "string" ? result.msg : "رفضت Kie.ai الطلب.";
    if (code === 429) {
      kieCooldowns.set(item.id, Date.now() + 10_000);
      continue;
    }
    if (code === 401) {
      kieInvalidKeys.add(item.id);
      continue;
    }
    if (code === 402) {
      throw Object.assign(new Error("رصيد Kie.ai غير كافٍ. الرصيد موحد للحساب، فتبديل المفتاح لن يحل المشكلة."), { status: 402 });
    }
    throw Object.assign(new Error(lastMessage), { status: code >= 400 && code <= 599 ? code : 502 });
  }
  const status = lastCode === 429 ? 429 : (lastCode === 401 ? 401 : 502);
  const message = status === 429
    ? "المفاتيح المتاحة وصلت حد الاستخدام؛ جُرّبت المفاتيح التالية. أعد المحاولة بعد انتهاء المهلة."
    : "المفاتيح المتاحة لم تُقبل من Kie.ai. راجعها من الإعدادات.";
  throw Object.assign(new Error(message), { status });
}

async function migrate(target = db) {
  const schema = await readFile(path.join(root, "schema.sql"), "utf8");
  for (const statement of schema.split(";").map((sql) => sql.trim()).filter(Boolean)) {
    await target.execute(statement);
  }
}

async function updateDatabaseConnection(url, token) {
  let nextUrl = "";
  let nextToken = "";
  if (!url && !token) {
    nextUrl = "";
    nextToken = "";
  } else if (typeof url === "string" && url.startsWith("libsql://") && typeof token === "string" && token.length >= 20 && token.length <= 8192) {
    nextUrl = url.trim();
    nextToken = token.trim();
  } else {
    throw Object.assign(new Error("أدخل عنوان Turso يبدأ بـ libsql:// ورمز دخول صالح."), { status: 400 });
  }
  const nextUsingLocalDb = !nextUrl || !nextToken;
  const nextConfigIncomplete = Boolean(nextUrl) !== Boolean(nextToken);
  const nextDb = createClient(nextUsingLocalDb
    ? { url: `file:${path.join(root, "hekaya-local.db")}` }
    : { url: nextUrl, authToken: nextToken });
  const envText = [
    nextUrl ? `TURSO_DATABASE_URL=${nextUrl}` : "",
    nextToken ? `TURSO_AUTH_TOKEN=${nextToken}` : "",
    `PORT=${port}`,
    "",
  ].filter((line, index, all) => line || index < all.length - 1).join("\n");
  try {
    await migrate(nextDb);
    await writeFile(path.join(root, ".env"), envText, { encoding: "utf8", mode: 0o600 });
    const previous = db;
    db = nextDb;
    databaseUrl = nextUrl;
    authToken = nextToken;
    usingLocalDb = nextUsingLocalDb;
    configIncomplete = nextConfigIncomplete;
    previous.close();
  } catch (error) {
    nextDb.close();
    throw error;
  }
}

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

function validSession(req) {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret || !process.env.APP_ACCESS_PASSWORD) return false;
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)hekaya_session=([^;]+)/);
  if (!match) return false;
  const [expires, signature] = decodeURIComponent(match[1]).split(".");
  if (!/^\d+$/.test(expires || "") || Number(expires) <= Date.now() || !signature) return false;
  const expected = createHmac("sha256", secret).update(expires).digest("hex");
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw Object.assign(new Error("Payload too large"), { status: 413 });
  }
  try { return JSON.parse(body || "{}"); }
  catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
}

const validText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const validPlatforms = (value) => Array.isArray(value) && value.length <= 4 && value.every((p) => typeof p === "string" && p.length <= 40);


async function handleApi(req, res, url) {
  const isVercel = isVercelDeployment;
  if (isVercel && req.method === "GET" && url.pathname === "/api/auth/status") {
    const configured = Boolean(process.env.APP_ACCESS_PASSWORD && process.env.APP_SESSION_SECRET);
    return json(res, 200, { required: true, configured, authorized: configured && validSession(req) });
  }
  if (isVercel && req.method === "POST" && url.pathname === "/api/auth/login") {
    if (!process.env.APP_ACCESS_PASSWORD || !process.env.APP_SESSION_SECRET) return json(res, 503, { error: "اضبط APP_ACCESS_PASSWORD وAPP_SESSION_SECRET في إعدادات Vercel أولًا." });
    const body = await readBody(req);
    const expected = Buffer.from(process.env.APP_ACCESS_PASSWORD);
    const provided = Buffer.from(typeof body.password === "string" ? body.password : "");
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return json(res, 401, { error: "كلمة المرور غير صحيحة." });
    const expires = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const signature = createHmac("sha256", process.env.APP_SESSION_SECRET).update(expires).digest("hex");
    res.setHeader("set-cookie", `hekaya_session=${encodeURIComponent(`${expires}.${signature}`)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`);
    return json(res, 200, { ok: true });
  }
    const ffmpegAsset = url.pathname.match(/^\/ffmpeg\/(worker|const|errors)\.js$/);
    if (req.method === "GET" && ffmpegAsset) {
      const upstream = await fetch(`https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/${ffmpegAsset[1]}.js`);
      if (!upstream.ok) return json(res, 502, { error: "تعذر تحميل مكوّن محرك المونتاج." });
      const script = await upstream.text();
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" });
      return res.end(script);
    }
  if (isVercel && url.pathname !== "/api/health" && !validSession(req)) {
    return json(res, process.env.APP_ACCESS_PASSWORD && process.env.APP_SESSION_SECRET ? 401 : 503, { error: "سجّل دخولك أو اضبط حماية التطبيق في إعدادات Vercel." });
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    if (isVercel && usingLocalDb) return json(res, 503, { ok: false, connected: false, database: "unconfigured", configIncomplete: true });
    try {
      await db.execute("SELECT 1 AS connected");
      return json(res, 200, { ok: true, connected: true, database: usingLocalDb ? "local" : "turso", configIncomplete });
    } catch {
      return json(res, 503, { ok: false, connected: false, database: usingLocalDb ? "local" : "turso", configIncomplete });
    }
  }
  if (url.pathname.startsWith("/api/settings/") || url.pathname.startsWith("/api/kie/")) {
    const origin = req.headers.origin;
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const allowedOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `${protocol}://${req.headers.host}`];
    if (origin && !allowedOrigins.includes(origin)) return json(res, 403, { error: "الطلب مرفوض." });
  }
  if (req.method === "GET" && url.pathname === "/api/settings/database") {
    return json(res, 200, { database: isVercel && usingLocalDb ? "unconfigured" : usingLocalDb ? "local" : "turso", databaseUrl: databaseUrl || "", configIncomplete });
  }
  if (req.method === "POST" && url.pathname === "/api/settings/database") {
    if (isVercelDeployment) return json(res, 409, { error: "إعداد قاعدة Turso على Vercel يتم من متغيرات البيئة TURSO_DATABASE_URL وTURSO_AUTH_TOKEN." });
    const body = await readBody(req);
    try {
      await updateDatabaseConnection(body.databaseUrl, body.authToken);
      return json(res, 200, { ok: true, database: usingLocalDb ? "local" : "turso", configIncomplete });
    } catch (error) {
      return json(res, error.status || 400, { error: error.status ? error.message : "تعذر الاتصال بقاعدة Turso. راجع العنوان ورمز الدخول." });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/settings/database/disconnect") {
    if (isVercelDeployment) return json(res, 409, { error: "غيّر أو احذف متغيرات Turso من إعدادات مشروع Vercel." });
    try {
      await updateDatabaseConnection("", "");
      return json(res, 200, { ok: true, database: "local" });
    } catch {
      return json(res, 500, { error: "تعذر فصل قاعدة البيانات." });
    }
  }
  if (url.pathname === "/api/settings/mcp-token") {
    if (isVercelDeployment && (!db || usingLocalDb)) return json(res, 503, { error: "قاعدة Turso غير متصلة؛ لا يمكن إدارة مفتاح MCP." });
    try {
      await db.execute("CREATE TABLE IF NOT EXISTS mcp_tokens (id INTEGER PRIMARY KEY CHECK (id = 1), token_hash TEXT NOT NULL, created_at TEXT NOT NULL)");
      if (req.method === "GET") {
        const result = await db.execute("SELECT created_at FROM mcp_tokens WHERE id = 1");
        return json(res, 200, { configured: result.rows.length > 0, createdAt: result.rows[0]?.created_at || null, endpoint: "https://vid-ali-b36b.vercel.app/api/mcp" });
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        if (body.action === "revoke") {
          await db.execute("DELETE FROM mcp_tokens WHERE id = 1");
          return json(res, 200, { ok: true, configured: false });
        }
        if (body.action !== "generate") return json(res, 400, { error: "إجراء غير صالح." });
        const token = "hk_" + randomBytes(36).toString("base64url");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const createdAt = new Date().toISOString();
        await db.execute({ sql: "INSERT INTO mcp_tokens (id, token_hash, created_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at", args: [tokenHash, createdAt] });
        return json(res, 200, { ok: true, token, createdAt, endpoint: "https://vid-ali-b36b.vercel.app/api/mcp" });
      }
      return json(res, 405, { error: "الطريقة غير مدعومة." }, { allow: "GET, POST" });
    } catch (error) {
      console.error("MCP token settings failed:", error.message);
      return json(res, 503, { error: "تعذر إدارة مفتاح MCP. تأكد من اتصال قاعدة Turso." });
    }
  }
  if (req.method === "GET" && url.pathname === "/api/settings/kie-keys") {
    if (isVercelDeployment && db && !usingLocalDb) await loadKieKeys();
    return json(res, 200, { keys: publicKieKeys(), rotation: "round-robin-with-429-failover" });
  }
  if (req.method === "POST" && url.pathname === "/api/settings/kie-keys") {
    if (isVercelDeployment && (!db || usingLocalDb)) return json(res, 503, { error: "قاعدة Turso غير متصلة؛ لا يمكن حفظ مفاتيح Kie.ai." });
    if (isVercelDeployment && db && !usingLocalDb) await loadKieKeys();
    const body = await readBody(req);
    if (body.action === "add") {
      if (!validText(body.apiKey, 1000) || body.apiKey.trim().length < 16) return json(res, 400, { error: "مفتاح Kie.ai غير صالح أو قصير." });
      const secret = body.apiKey.trim();
      if (kieKeys.some((item) => item.secret === secret)) return json(res, 409, { error: "المفتاح مضاف بالفعل." });
      const item = { id: randomUUID(), label: validText(body.label, 80) ? body.label.trim() : `مفتاح ${kieKeys.length + 1}`, secret };
      kieKeys.push(item);
      try { await saveKieKeys(); }
      catch { kieKeys = kieKeys.filter((key) => key.id !== item.id); return json(res, 500, { error: "تعذر حفظ مفتاح Kie.ai في قاعدة البيانات." }); }
      return json(res, 201, { keys: publicKieKeys() });
    }
    if (body.action === "remove" && typeof body.id === "string") {
      const old = kieKeys;
      kieKeys = kieKeys.filter((item) => item.id !== body.id);
      if (kieKeys.length === old.length) return json(res, 404, { error: "المفتاح غير موجود." });
      kieInvalidKeys.delete(body.id);
      kieCooldowns.delete(body.id);
      try { await saveKieKeys(); }
      catch { kieKeys = old; return json(res, 500, { error: "تعذر تحديث قائمة مفاتيح Kie.ai." }); }
      return json(res, 200, { keys: publicKieKeys() });
    }
    return json(res, 400, { error: "الإجراء غير معروف." });
  }
  if (req.method === "POST" && url.pathname === "/api/ai/generate-story") {
    if (!process.env.HEKAYA_OPENAI_API_KEY) return json(res, 503, { error: "أضف HEKAYA_OPENAI_API_KEY في إعدادات Vercel لتفعيل كتابة القصص بالذكاء الاصطناعي." });
    const body = await readBody(req);
    const topic = typeof body.topic === "string" ? body.topic.trim() : "";
    if (topic.length > 1200) return json(res, 400, { error: "الفكرة طويلة جدًا؛ اختصرها إلى 1200 حرف." });
    const genre = validText(body.genre, 100) ? body.genre : "قصة غموض وتشويق";
    const dialect = validText(body.dialect, 100) ? body.dialect : "عامية مصرية بسيطة";
    const duration = validText(body.duration, 40) ? body.duration : "45 ثانية";
    const prompt = [
      "أنت كاتب ومخرج محتوى قصصي محترف لقناة عربية تصنع فيديوهات قصيرة عمودية.",
      "ابتكر قصة أصلية جذابة وقابلة للتصوير، وليست قالبًا عامًا. ابدأ بخطاف قوي خلال أول ثانيتين، ثم تصاعد واضح، ومفاجأة أو لحظة مؤثرة، ونهاية قوية تدعو للتفاعل دون ابتذال.",
      "اكتب باللهجة المطلوبة، والتزم بالمدة المطلوبة. قسم النص إلى مشاهد قصيرة مع توجيه بصري وصوتي واضح. لا تدّعِ أن القصة حقيقة إذا كانت خيالية.",
      "أعد JSON فقط وفق المخطط المحدد.",
      "الفكرة/الموضوع: " + (topic || "اختر أنت فكرة جديدة وغير مكررة تناسب الجمهور العربي."),
      "النوع: " + genre,
      "اللهجة: " + dialect,
      "المدة: " + duration
    ].join("\n");
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.HEKAYA_OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.HEKAYA_STORY_MODEL || "gpt-6.1-sol",
          input: prompt,
          max_output_tokens: 2600,
          text: { format: { type: "json_schema", name: "hekaya_story", strict: true, schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              hook: { type: "string" },
              story: { type: "string" },
              caption: { type: "string" },
              hashtags: { type: "array", items: { type: "string" } },
              visual_direction: { type: "string" }
            },
            required: ["title", "hook", "story", "caption", "hashtags", "visual_direction"],
            additionalProperties: false
          } } }
        })
      });
      const data = await response.json();
      if (!response.ok) {
        const message = data?.error?.message || "تعذر توليد القصة من خدمة الذكاء الاصطناعي.";
        return json(res, response.status === 401 ? 401 : response.status === 429 ? 429 : 502, { error: message });
      }
      const outputText = (data.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text).join("");
      if (!outputText) return json(res, 502, { error: "خدمة الذكاء الاصطناعي لم ترجع نص القصة." });
      const story = JSON.parse(outputText);
      if (!validText(story.title, 180) || !validText(story.story, 30000)) return json(res, 502, { error: "القصة الناتجة غير مكتملة؛ حاول مرة أخرى." });
      return json(res, 200, { ...story, model: data.model || process.env.HEKAYA_STORY_MODEL || "gpt-6.1-sol" });
    } catch (error) {
      return json(res, error.status || 502, { error: error instanceof SyntaxError ? "تعذر قراءة تنسيق القصة؛ أعد المحاولة." : "تعذر الاتصال بخدمة كتابة القصص." });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/github/publish-story") {
    if (!process.env.HEKAYA_GITHUB_TOKEN) return json(res, 503, { error: "أضف HEKAYA_GITHUB_TOKEN في Vercel لتفعيل إرسال القصص إلى GitHub." });
    const body = await readBody(req);
    if (!validText(body.title, 180) || !validText(body.story, 30000)) return json(res, 400, { error: "العنوان أو نص القصة غير صالح." });
    const id = randomUUID();
    const slug = body.title.trim().toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "hekaya-story";
    const filePath = `content-inbox/${new Date().toISOString().slice(0,10)}-${slug}-${id.slice(0,8)}.json`;
    const document = {
      id, title: body.title.trim(), topic: typeof body.topic === "string" ? body.topic.slice(0,1200) : "",
      story: body.story, caption: typeof body.caption === "string" ? body.caption.slice(0,3000) : "",
      hashtags: Array.isArray(body.hashtags) ? body.hashtags.filter(x => typeof x === "string").slice(0,20) : [],
      visual_direction: typeof body.visual_direction === "string" ? body.visual_direction.slice(0,3000) : "",
      platforms: validPlatforms(body.platforms) ? body.platforms : [],
      source: "hekaya-studio", status: "ready_for_review", created_at: new Date().toISOString()
    };
    try {
      const gh = await fetch(`https://api.github.com/repos/AliShaban56/VID/contents/${filePath}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${process.env.HEKAYA_GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: `Add story to publishing inbox: ${body.title.trim().slice(0,70)}`,
          content: Buffer.from(JSON.stringify(document, null, 2), "utf8").toString("base64"),
          branch: "main"
        })
      });
      const result = await gh.json();
      if (!gh.ok) return json(res, gh.status === 401 || gh.status === 403 ? 502 : 502, { error: gh.status === 404 ? "المستودع أو الفرع غير متاح للمفتاح. راجع صلاحية Contents: Read and write." : (result?.message || "تعذر إرسال القصة إلى GitHub.") });
      return json(res, 201, { ok: true, path: filePath, commit: result.commit?.sha || "", url: result.content?.html_url || "" });
    } catch {
      return json(res, 502, { error: "تعذر الاتصال بـ GitHub. حاول مرة أخرى." });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/kie/images") {
    const body = await readBody(req);
    const aspect = ["9:16", "16:9", "1:1"].includes(body.aspectRatio) ? body.aspectRatio : "9:16";
    if (!validText(body.prompt, 4000)) return json(res, 400, { error: "اكتب وصفًا للصورة أولًا." });
    try {
      const { result } = await kieRequest("/api/v1/jobs/createTask", {
        model: "gpt-image-2-6/flare-text-to-image",
        input: { prompt: body.prompt.trim(), aspect_ratio: aspect, resolution: "1K", quality: "medium", background: "auto", output_format: "png" },
      });
      const taskId = result?.data?.taskId;
      if (!taskId) return json(res, 502, { error: "لم ترجع Kie.ai رقم المهمة." });
      return json(res, 202, { taskId, model: "gpt-image-2-6/flare-text-to-image" });
    } catch (error) { return json(res, error.status || 502, { error: error.message }); }
  }
  if (req.method === "POST" && url.pathname === "/api/kie/videos") {
    const body = await readBody(req);
    if (!validText(body.prompt, 4000) || typeof body.imageUrl !== "string" || !body.imageUrl.startsWith("https://")) return json(res, 400, { error: "نحتاج وصف الفيديو ورابط الصورة الناتجة." });
    try {
      const { result } = await kieRequest("/api/v1/jobs/createTask", {
        model: "grok-imagine-video-1-5-preview",
        input: { prompt: body.prompt.trim(), image_urls: [body.imageUrl], aspect_ratio: "9:16", resolution: "480p", duration: 8 },
      });
      const taskId = result?.data?.taskId;
      if (!taskId) return json(res, 502, { error: "لم ترجع Kie.ai رقم مهمة الفيديو." });
      return json(res, 202, { taskId, model: "grok-imagine-video-1-5-preview" });
    } catch (error) { return json(res, error.status || 502, { error: error.message }); }
  }
  const taskMatch = url.pathname.match(/^\/api\/kie\/jobs\/([^/]+)$/);
  if (req.method === "GET" && (taskMatch || url.pathname === "/api/kie/jobs")) {
    const taskId = taskMatch ? decodeURIComponent(taskMatch[1]) : url.searchParams.get("taskId");
    if (!validText(taskId, 200)) return json(res, 400, { error: "رقم المهمة غير صالح." });
    try {
      const { result } = await kieRequest(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
      const data = result?.data || {};
      let resultData = {};
      try { resultData = typeof data.resultJson === "string" ? JSON.parse(data.resultJson) : (data.resultJson || {}); } catch {}
      return json(res, 200, { taskId, state: data.state || "unknown", progress: data.progress ?? null, resultUrls: resultData.resultUrls || [], failMsg: data.failMsg || "" });
    } catch (error) { return json(res, error.status || 502, { error: error.message }); }
  }
  if (req.method === "GET" && url.pathname === "/api/drafts") {
    const result = await db.execute("SELECT id, title, topic, story, platforms_json, created_at FROM drafts ORDER BY created_at DESC LIMIT 100");
    return json(res, 200, { items: result.rows.map((row) => ({ ...row, platforms: JSON.parse(row.platforms_json || "[]") })) });
  }
  if (req.method === "POST" && url.pathname === "/api/drafts") {
    const body = await readBody(req);
    if (!validText(body.title, 160) || !validText(body.topic, 2000) || !validText(body.story, 30000) || !validPlatforms(body.platforms)) {
      return json(res, 400, { error: "راجع عنوان المسودة وفكرتها والنص والمنصات." });
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    await db.execute({
      sql: "INSERT INTO drafts (id, title, topic, story, platforms_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [id, body.title.trim(), body.topic.trim(), body.story, JSON.stringify(body.platforms), now, now],
    });
    return json(res, 201, { id, created_at: now, database: usingLocalDb ? "local" : "turso" });
  }
  if (req.method === "GET" && url.pathname === "/api/schedules") {
    const result = await db.execute("SELECT id, title, topic, story, platforms_json, scheduled_at, status, created_at FROM scheduled_posts ORDER BY scheduled_at LIMIT 100");
    return json(res, 200, { items: result.rows.map((row) => ({ ...row, platforms: JSON.parse(row.platforms_json || "[]") })) });
  }
  if (req.method === "POST" && url.pathname === "/api/schedules") {
    const body = await readBody(req);
    const scheduled = new Date(body.scheduledAt);
    if (!validText(body.title, 160) || !validText(body.topic, 2000) || !validText(body.story, 30000) || !validPlatforms(body.platforms) || !body.platforms.length || Number.isNaN(scheduled.getTime())) {
      return json(res, 400, { error: "راجع موعد النشر والنص والمنصات." });
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    await db.execute({
      sql: "INSERT INTO scheduled_posts (id, title, topic, story, platforms_json, scheduled_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)",
      args: [id, body.title.trim(), body.topic.trim(), body.story, JSON.stringify(body.platforms), scheduled.toISOString(), now, now],
    });
    return json(res, 201, { id, scheduledAt: scheduled.toISOString(), database: usingLocalDb ? "local" : "turso" });
  }
  return json(res, 404, { error: "المسار غير موجود." });
}

if (!isVercelDeployment || !usingLocalDb) await migrate();
if (isVercelDeployment && db && !usingLocalDb) await loadKieKeys();
export async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/mcp" || url.pathname.startsWith("/api/mcp/")) return await mcpHandler(req, res);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method === "GET" && url.pathname === "/editor-ui.js") {
      const script = await readFile(path.join(root, "editor-ui.js"));
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      return res.end(script);
    }
    if (req.method === "GET" && url.pathname === "/auth-ui.js") {
      const script = await readFile(path.join(root, "auth-ui.js"));
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      return res.end(script);
    }
    if (req.method === "GET" && url.pathname === "/workflow-ui.js") {
      const script = await readFile(path.join(root, "workflow-ui.js"));
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      return res.end(script);
    }
    if (req.method === "GET" && url.pathname === "/kie-ui.js") {
      const script = await readFile(path.join(root, "kie-ui.js"));
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      return res.end(script);
    }
    if (req.method !== "GET" || !["/", "/index.html"].includes(url.pathname)) return json(res, 404, { error: "الصفحة غير موجودة." });
    const html = await readFile(path.join(root, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" });
    res.end(html);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("Request failed:", error.message);
    json(res, status, { error: status === 500 ? "حصل خطأ داخلي. راجع إعدادات قاعدة البيانات." : error.message });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer(handleRequest);
  server.listen(port, "127.0.0.1", () => {
    console.log(`حكاية شغالة على http://127.0.0.1:${port} (${usingLocalDb ? "قاعدة محلية" : "Turso"})`);
  });

  process.on("SIGINT", () => { server.close(); db.close(); });
  process.on("SIGTERM", () => { server.close(); db.close(); });
}


export default handleRequest;
