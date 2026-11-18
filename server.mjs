import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createHmac, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@libsql/client";
import mcpHandler from "./api/mcp.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
// Agnes AI multi-key rotation.
 let agnesKeys = [];
 const agnesCooldowns = new Map();
 const agnesInvalidKeys = new Set();
 async function loadAgnesKeys() {
   await db.execute("CREATE TABLE IF NOT EXISTS agnes_api_keys (id INTEGER PRIMARY KEY CHECK (id = 1), secret TEXT NOT NULL, created_at TEXT NOT NULL)");
   await db.execute("CREATE TABLE IF NOT EXISTS agnes_multi_keys (id TEXT PRIMARY KEY, label TEXT NOT NULL, secret TEXT NOT NULL, created_at TEXT NOT NULL)");
   const legacy = (await db.execute("SELECT secret, created_at FROM agnes_api_keys WHERE id = 1")).rows[0];
   const current = (await db.execute("SELECT id, label, secret FROM agnes_multi_keys ORDER BY created_at ASC")).rows;
   if (legacy?.secret && !current.some(row => row.secret === legacy.secret)) {
     await db.execute({sql:"INSERT INTO agnes_multi_keys (id,label,secret,created_at) VALUES (?,?,?,?)",args:["legacy-agnes-key","مفتاح Agnes السابق",legacy.secret,legacy.created_at || new Date().toISOString()]});
   }
   const rows = (await db.execute("SELECT id,label,secret FROM agnes_multi_keys ORDER BY created_at ASC")).rows;
   agnesKeys = rows.map(row=>({id:String(row.id),label:String(row.label||"Agnes key"),secret:String(row.secret)}));
 }
 function publicAgnesKeys() {
   const now=Date.now();
   return agnesKeys.map(k=>({id:k.id,label:k.label,masked:"••••"+k.secret.slice(-4),status:agnesInvalidKeys.has(k.id)?"invalid":(agnesCooldowns.get(k.id)>now?"cooldown":"ready"),retryIn:Math.max(0,Math.ceil(((agnesCooldowns.get(k.id)||0)-now)/1000))}));
 }
 async function nextAgnesKeyIndex(targetDb,count){
   await targetDb.execute("CREATE TABLE IF NOT EXISTS agnes_key_rotation (id INTEGER PRIMARY KEY CHECK (id = 1), next_index INTEGER NOT NULL DEFAULT 0)");
   await targetDb.execute("INSERT OR IGNORE INTO agnes_key_rotation (id,next_index) VALUES (1,0)");
   const result=await targetDb.execute({sql:"UPDATE agnes_key_rotation SET next_index=(next_index+1)%? WHERE id=1 RETURNING (next_index+?-1)%? AS assigned_index",args:[count,count,count]});
   return Number(result.rows[0]?.assigned_index||0);
 }
 async function agnesRequest(pathname, payload, {retryNetwork=false}={}) {
   if (!db || usingLocalDb) throw Object.assign(new Error("Turso unavailable for Agnes key retrieval."),{status:503});
   await loadAgnesKeys();
   if(!agnesKeys.length) throw Object.assign(new Error("أضف مفتاح Agnes AI واحدًا على الأقل من الإعدادات."),{status:409});
   const start=await nextAgnesKeyIndex(db,agnesKeys.length);
   const order=agnesKeys.map((_,i)=>agnesKeys[(start+i)%agnesKeys.length]);
   const available=order.filter(k=>!agnesInvalidKeys.has(k.id)&&((agnesCooldowns.get(k.id)||0)<=Date.now()));
   if(!available.length) throw Object.assign(new Error("كل مفاتيح Agnes في مهلة مؤقتة أو غير صالحة. أعد المحاولة لاحقًا."),{status:429});
   let lastStatus=502,lastMsg="Agnes AI request failed.";
   for(const key of available){
     let response,data;
     try{
       response=await fetch("https://apihub.agnes-ai.com"+pathname,{method:payload===undefined?"GET":"POST",headers:{authorization:"Bearer "+key.secret,"content-type":"application/json"},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
       data=await response.json().catch(()=>({}));
     }catch{
       if(!retryNetwork) throw Object.assign(new Error("Agnes connection error; request was not retried to avoid duplicate video jobs."),{status:502});
       lastStatus=502;continue;
     }
     if(response.ok){agnesInvalidKeys.delete(key.id);agnesCooldowns.delete(key.id);return {data,keyId:key.id};}
     lastStatus=response.status;lastMsg=data.error?.message||data.message||data.error||"Agnes request failed.";
     if(response.status===429){agnesCooldowns.set(key.id,Date.now()+45000);continue;}
     if(response.status===401||response.status===403){agnesInvalidKeys.add(key.id);continue;}
     if(response.status===402||response.status>=500)continue;
     throw Object.assign(new Error(String(lastMsg)),{status:response.status});
   }
   throw Object.assign(new Error(lastStatus===429?"Agnes keys reached rate limits; temporary cooldown applied.":lastMsg),{status:lastStatus===429?429:502});
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
  if (url.pathname.startsWith("/api/kie/") || url.pathname === "/api/settings/kie-keys" || url.pathname.startsWith("/api/agent/kie/")) return json(res, 410, { error: "Kie.ai integration has been permanently disabled. Hekaya uses Agnes AI only." });
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
    const ffmpegAsset = url.pathname.match(/^\/ffmpeg\/(worker|classes|const|errors)\.js$/);
    if (req.method === "GET" && ffmpegAsset) {
      const upstream = await fetch(`https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/${ffmpegAsset[1]}.js`);
      if (!upstream.ok) return json(res, 502, { error: "تعذر تحميل مكوّن محرك المونتاج." });
      const script = await upstream.text();
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" });
      return res.end(script);
    }
  let agentAuthorized = false;
  if (url.pathname.startsWith("/api/agent/")) {
    try { if (!db || usingLocalDb) return json(res, 503, { error: "Agent Control requires connected Turso database." }); await db.execute("CREATE TABLE IF NOT EXISTS agent_control_tokens (id INTEGER PRIMARY KEY CHECK (id = 1), token_hash TEXT NOT NULL, created_at TEXT NOT NULL)"); const auth = req.headers.authorization || ""; const supplied = auth.startsWith("Bearer ") ? auth.slice(7).trim() : ""; const row = (await db.execute("SELECT token_hash FROM agent_control_tokens WHERE id = 1")).rows[0]; const hash = supplied ? createHash("sha256").update(supplied).digest("hex") : ""; agentAuthorized = Boolean(row?.token_hash && hash && hash === row.token_hash); } catch { return json(res, 503, { error: "Agent Control authentication unavailable." }); }
    if (!agentAuthorized) return json(res, 401, { error: "Agent token missing or invalid." });
  }
  if (isVercel && url.pathname !== "/api/health" && !agentAuthorized && !validSession(req)) {
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
  if (url.pathname === "/api/settings/agent-token") {
    if (isVercelDeployment && (!db || usingLocalDb)) return json(res, 503, { error: "Turso disconnected." });
    try { await db.execute("CREATE TABLE IF NOT EXISTS agent_control_tokens (id INTEGER PRIMARY KEY CHECK (id = 1), token_hash TEXT NOT NULL, created_at TEXT NOT NULL)"); if (req.method === "GET") { const row = (await db.execute("SELECT created_at FROM agent_control_tokens WHERE id = 1")).rows[0]; return json(res, 200, { configured: Boolean(row), createdAt: row?.created_at || null, baseUrl: "https://vid-ali-b36b.vercel.app/api/agent" }); } if (req.method === "POST") { const body = await readBody(req); if (body.action === "revoke") { await db.execute("DELETE FROM agent_control_tokens WHERE id = 1"); return json(res, 200, { ok: true, configured: false }); } if (body.action !== "generate") return json(res, 400, { error: "Invalid action." }); const token = "hka_" + randomBytes(40).toString("base64url"); const tokenHash = createHash("sha256").update(token).digest("hex"); const createdAt = new Date().toISOString(); await db.execute({ sql: "INSERT INTO agent_control_tokens (id, token_hash, created_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at", args: [tokenHash, createdAt] }); return json(res, 200, { ok: true, token, createdAt, baseUrl: "https://vid-ali-b36b.vercel.app/api/agent", warning: "Copy this token now; it will not be shown again." }); } return json(res, 405, { error: "Method not allowed." }); } catch { return json(res, 503, { error: "Agent Control token management failed." }); }
  }
  if (agentAuthorized && url.pathname === "/api/agent/episodes") {
    try {
      await db.execute("CREATE TABLE IF NOT EXISTS agent_episodes (slug TEXT PRIMARY KEY, title TEXT NOT NULL, script TEXT NOT NULL, caption TEXT NOT NULL, hashtags TEXT NOT NULL, scenes TEXT NOT NULL, thumbnail_prompt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', video_url TEXT, github_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
      if (req.method === "GET") { const slug=url.searchParams.get("slug"); const rows=slug ? (await db.execute({sql:"SELECT * FROM agent_episodes WHERE slug = ?",args:[slug]})).rows : (await db.execute("SELECT * FROM agent_episodes ORDER BY created_at DESC LIMIT 50")).rows; return json(res,200,{episodes:rows.map(row=>({...row,hashtags:JSON.parse(row.hashtags||"[]"),scenes:JSON.parse(row.scenes||"[]")}))}); }
      if (req.method === "POST") { const body=await readBody(req); const slug=typeof body.slug==="string"&&/^[a-z0-9-]{2,80}$/.test(body.slug)?body.slug:""; if(!slug||!validText(body.title,200)||!validText(body.script,12000)||!validText(body.caption,1000)||!Array.isArray(body.hashtags)||body.hashtags.length>30||!Array.isArray(body.scenes)||body.scenes.length>30||typeof body.thumbnailPrompt!=="string") return json(res,400,{error:"Required: slug, title, script, caption, hashtags[], scenes[], thumbnailPrompt."}); const now=new Date().toISOString(); const tags=JSON.stringify(body.hashtags.map(x=>String(x).slice(0,80))); const scenes=JSON.stringify(body.scenes); await db.execute({sql:"INSERT INTO agent_episodes (slug,title,script,caption,hashtags,scenes,thumbnail_prompt,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'draft',?,?) ON CONFLICT(slug) DO UPDATE SET title=excluded.title,script=excluded.script,caption=excluded.caption,hashtags=excluded.hashtags,scenes=excluded.scenes,thumbnail_prompt=excluded.thumbnail_prompt,updated_at=excluded.updated_at",args:[slug,body.title.trim(),body.script.trim(),body.caption.trim(),tags,scenes,body.thumbnailPrompt,now,now]}); return json(res,201,{ok:true,slug,status:"draft"}); }
      return json(res,405,{error:"Method not allowed."});
    } catch { return json(res,503,{error:"Episode storage unavailable."}); }
  }
  if (agentAuthorized && req.method === "GET" && url.pathname === "/api/agent/status") return json(res, 200, { ok: true, service: "Hekaya Studio Agent Control", version: 1, capabilities: ["episode-draft-storage", "episode-listing", "agnes-video-generation", "agnes-job-status", "kie-video-generation", "kie-job-status"], timezone: "Africa/Cairo" });
  if (agentAuthorized && req.method === "POST" && url.pathname === "/api/agent/agnes/videos") {
    const body=await readBody(req); if(!validText(body.prompt,4000)||typeof body.imageUrl!=="string"||!body.imageUrl.startsWith("https://"))return json(res,400,{error:"Prompt and HTTPS imageUrl are required."});
    try{const {data}=await agnesRequest("/v1/videos",{model:"agnes-video-2.5-flash",prompt:body.prompt.trim(),mode:"keyframe",first_frame:body.imageUrl,seconds:"8",size:"720P",aspect_ratio:"9:16",n:1});const videoId=data.video_id||data.id||data.task_id||data.data?.video_id||data.data?.id||data.data?.task_id;if(!videoId)return json(res,502,{error:"Agnes response missing task ID."});return json(res,202,{videoId:String(videoId),model:"agnes-video-2.5-flash"});}catch(error){return json(res,error.status||502,{error:error.message});}
  }
  if (agentAuthorized && req.method === "GET" && url.pathname === "/api/agent/agnes/jobs") {
    const videoId=url.searchParams.get("videoId");if(!validText(videoId,200))return json(res,400,{error:"Invalid task ID."});
    try{const {data}=await agnesRequest("/agnesapi?video_id="+encodeURIComponent(videoId)+"&model_name=agnes-video-2.5-flash",undefined,{retryNetwork:true});return json(res,200,{videoId,status:data.status||data.data?.status||"processing",videoUrl:data.url||data.data?.url||data.video_url||data.data?.video_url||null,progress:data.progress??data.data?.progress??null,error:data.error||data.data?.error||""});}catch(error){return json(res,error.status||502,{error:error.message});}
  }
  if (url.pathname === "/api/settings/agnes-keys") {
    if(isVercelDeployment&&(!db||usingLocalDb))return json(res,503,{error:"قاعدة Turso غير متصلة؛ لا يمكن حفظ مفاتيح Agnes AI."});
    try{await loadAgnesKeys();
      if(req.method==="GET")return json(res,200,{keys:publicAgnesKeys(),rotation:"round-robin-failover-401-402-429-5xx"});
      if(req.method==="POST"){const body=await readBody(req);
        if(body.action==="add"){if(!validText(body.apiKey,2000)||body.apiKey.trim().length<16)return json(res,400,{error:"مفتاح Agnes AI غير صالح أو قصير."});const secret=body.apiKey.trim();if(agnesKeys.some(k=>k.secret===secret))return json(res,409,{error:"المفتاح مضاف بالفعل."});const item={id:randomUUID(),label:validText(body.label,80)?body.label.trim():("Agnes key "+(agnesKeys.length+1)),secret};await db.execute({sql:"INSERT INTO agnes_multi_keys (id,label,secret,created_at) VALUES (?,?,?,?)",args:[item.id,item.label,item.secret,new Date().toISOString()]});await loadAgnesKeys();return json(res,201,{keys:publicAgnesKeys()});}
        if(body.action==="remove"&&typeof body.id==="string"){const found=agnesKeys.some(k=>k.id===body.id);if(!found)return json(res,404,{error:"المفتاح غير موجود."});await db.execute({sql:"DELETE FROM agnes_multi_keys WHERE id = ?",args:[body.id]});agnesInvalidKeys.delete(body.id);agnesCooldowns.delete(body.id);await loadAgnesKeys();return json(res,200,{keys:publicAgnesKeys()});}
        return json(res,400,{error:"الإجراء غير معروف."});
      }
      return json(res,405,{error:"الطريقة غير مدعومة."});
    }catch(error){console.error("Agnes key settings failed:",error.message);return json(res,503,{error:"تعذر إدارة مفاتيح Agnes AI. تأكد من اتصال Turso."});}
  }
  // Legacy single-key settings route retained for compatibility with old clients.
  if (url.pathname === "/api/settings/agnes-key") {
    if(req.method==="GET"){await loadAgnesKeys();return json(res,200,{configured:agnesKeys.length>0,masked:agnesKeys[0]?.masked||null,createdAt:null});}
    if(req.method==="POST"){const body=await readBody(req);if(body.action==="remove"){if(agnesKeys[0])await db.execute({sql:"DELETE FROM agnes_multi_keys WHERE id = ?",args:[agnesKeys[0].id]});await loadAgnesKeys();return json(res,200,{ok:true,configured:agnesKeys.length>0});}if(body.action==="save"&&validText(body.apiKey,2000)&&body.apiKey.trim().length>=16){const secret=body.apiKey.trim();await db.execute({sql:"INSERT OR IGNORE INTO agnes_multi_keys (id,label,secret,created_at) VALUES (?,?,?,?)",args:[randomUUID(),"Agnes key",secret,new Date().toISOString()]});await loadAgnesKeys();return json(res,200,{ok:true,configured:true,masked:"••••"+secret.slice(-4)});}return json(res,400,{error:"مفتاح Agnes AI غير صالح."});}
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
  if (req.method === "POST" && url.pathname === "/api/metricool/schedule") {
    const body = await readBody(req);
    if (!validText(body.token, 4096) || !validText(body.userId, 128) || !validText(body.videoUrl, 4096) || !validText(body.caption, 3000) || !validText(body.schedule, 64)) return json(res, 400, { error: "راجع بيانات Metricool والنص ورابط الفيديو وموعد النشر." });
    if (!body.videoUrl.startsWith("https://")) return json(res, 400, { error: "رابط الفيديو لازم يكون HTTPS." });
    const scheduleDate = new Date(body.schedule + "+02:00");
    if (!Number.isFinite(scheduleDate.getTime()) || scheduleDate.getTime() <= Date.now()) return json(res, 400, { error: "موعد النشر لازم يكون في المستقبل." });
    const cairoDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(scheduleDate);
    const cairoTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(scheduleDate);
    const postBody = { publicationDate: { dateTime: cairoDate + "T" + cairoTime, timezone: "Africa/Cairo" }, text: body.caption, providers: [{ network: "tiktok" }], tiktokData: { title: body.caption.slice(0, 150), privacyOption: "PUBLIC_TO_EVERYONE" }, media: [body.videoUrl], saveExternalMediaFiles: true, autoPublish: true };
    try {
      const response = await fetch("https://app.metricool.com/api/v2/scheduler/posts?blogId=8194079&userId=" + encodeURIComponent(body.userId), { method: "POST", headers: { "X-Mc-Auth": body.token.trim(), "Content-Type": "application/json" }, body: JSON.stringify(postBody) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return json(res, response.status, { error: data.message || data.error || "Metricool رفض الجدولة؛ راجع API Token وuserId وخطة API." });
      return json(res, 201, { ok: true, message: "تم إرسال الفيديو إلى Metricool وجدولته للنشر على TikTok.", result: data });
    } catch { return json(res, 502, { error: "تعذر الاتصال بـ Metricool." }); }
  }
  if (req.method === "POST" && url.pathname === "/api/agnes/images") {
    const body = await readBody(req);
    const aspect = ["9:16", "16:9", "1:1"].includes(body.aspectRatio) ? body.aspectRatio : "9:16";
    if (!validText(body.prompt, 4000)) return json(res, 400, { error: "اكتب وصف الصورة أولًا." });
    try {
      const { data, keyId } = await agnesRequest("/v1/images/generations", { model: "agnes-image-2.5-flash", prompt: body.prompt.trim(), n: 1, size: aspect === "16:9" ? "1792x1024" : aspect === "1:1" ? "1024x1024" : "1024x1792", extra_body: { ratio: aspect, response_format: "url" } });
      const imageUrl = data.data?.[0]?.url || data.data?.[0]?.image_url || data.image_url || data.url;
      if (!imageUrl || typeof imageUrl !== "string" || !imageUrl.startsWith("https://")) return json(res, 502, { error: "Agnes لم ترجع رابط صورة صالحًا." });
      return json(res, 200, { imageUrl, model: "agnes-image-2.5-flash", provider: "Agnes AI", keyId });
    } catch (error) { return json(res, error.status || 502, { error: "تعذر الاتصال بـ Agnes لتوليد الصورة: " + error.message }); }
  }
  if (req.method === "POST" && url.pathname === "/api/agnes/videos") {
    const body = await readBody(req);
    if (!validText(body.prompt, 4000) || typeof body.imageUrl !== "string" || !body.imageUrl.startsWith("https://")) return json(res, 400, { error: "نحتاج وصف الفيديو ورابط الصورة." });
    try {
      const { data, keyId } = await agnesRequest("/v1/videos", { model: "agnes-video-2.5-flash", prompt: body.prompt.trim(), mode: "keyframe", first_frame: body.imageUrl, seconds: "8", size: "720P", aspect_ratio: "9:16", n: 1 });
      const videoId = data.video_id || data.id || data.task_id || data.data?.video_id || data.data?.id || data.data?.task_id;
      if (!videoId) return json(res, 502, { error: "Agnes لم ترجع رقم مهمة فيديو." });
      return json(res, 202, { videoId: String(videoId), model: "agnes-video-2.5-flash", provider: "Agnes AI", keyId });
    } catch (error) { return json(res, error.status || 502, { error: "تعذر الاتصال بـ Agnes: " + error.message }); }
  }
  if (req.method === "GET" && url.pathname === "/api/agnes/jobs") {
    const videoId = url.searchParams.get("videoId");
    if (!validText(videoId, 200)) return json(res, 400, { error: "رقم المهمة غير صالح." });
    try {
      const { data, keyId } = await agnesRequest("/agnesapi?video_id=" + encodeURIComponent(videoId) + "&model_name=agnes-video-2.5-flash", undefined, { retryNetwork: true });
      const task = data.data || data;
      return json(res, 200, { videoId, status: task.status || "processing", videoUrl: task.url || task.video_url || task.videoUrl || null, progress: task.progress ?? null, error: task.error || task.message || "", provider: "Agnes AI", keyId });
    } catch (error) { return json(res, error.status || 502, { error: "تعذر فحص مهمة Agnes: " + error.message }); }
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

export async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/mcp" || url.pathname.startsWith("/api/mcp/")) return await mcpHandler(req, res);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    const ffmpegAsset = url.pathname.match(/^\/ffmpeg\/(worker|classes|const|errors)\.js$/);
    if (req.method === "GET" && ffmpegAsset) {
      const upstream = await fetch(`https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/${ffmpegAsset[1]}.js`);
      if (!upstream.ok) return json(res, 502, { error: "تعذر تحميل مكوّن محرك المونتاج." });
      const script = await upstream.text();
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" });
      return res.end(script);
    }
    if (req.method === "GET" && url.pathname === "/agent.html") { const page = await readFile(path.join(root, "agent.html")); res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" }); return res.end(page); }
    if (req.method === "GET" && url.pathname === "/agent-control-ui.js") { const script = await readFile(path.join(root, "agent-control-ui.js")); res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); return res.end(script); }
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
    if (req.method === "GET" && url.pathname === "/agnes-settings.js") {
      const script = await readFile(path.join(root, "agnes-settings.js"));
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
