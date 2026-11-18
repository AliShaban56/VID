import { createClient } from "@libsql/client";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const json = (res, status, body, extra = {}) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
  res.end(JSON.stringify(body));
};
const textResult = (value, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) });
const tools = [
  { name: "hekaya_generate_image", description: "Generate a vertical story image with the configured Kie.ai account.", inputSchema: { type: "object", properties: { prompt: { type: "string", maxLength: 4000 }, aspectRatio: { type: "string", enum: ["9:16", "16:9", "1:1"] } }, required: ["prompt"], additionalProperties: false }, _meta: { securitySchemes: [{ type: "oauth2", scopes: ["hekaya:use"] }] } },
  { name: "hekaya_generate_video", description: "Animate a generated image into an 8-second vertical video. Supply a public HTTPS image URL.", inputSchema: { type: "object", properties: { prompt: { type: "string", maxLength: 4000 }, imageUrl: { type: "string", maxLength: 2000 } }, required: ["prompt", "imageUrl"], additionalProperties: false }, _meta: { securitySchemes: [{ type: "oauth2", scopes: ["hekaya:use"] }] } },
  { name: "hekaya_check_generation", description: "Check a Kie.ai image or video generation task and retrieve its result URLs.", inputSchema: { type: "object", properties: { taskId: { type: "string", maxLength: 200 } }, required: ["taskId"], additionalProperties: false }, _meta: { securitySchemes: [{ type: "oauth2", scopes: ["hekaya:use"] }] } },
  { name: "hekaya_save_draft", description: "Save a story draft in Hekaya Studio.", inputSchema: { type: "object", properties: { title: { type: "string", maxLength: 160 }, topic: { type: "string", maxLength: 2000 }, story: { type: "string", maxLength: 30000 }, platforms: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 4 } }, required: ["title", "topic", "story"], additionalProperties: false }, _meta: { securitySchemes: [{ type: "oauth2", scopes: ["hekaya:use"] }] } },
  { name: "hekaya_list_drafts", description: "List the latest saved story drafts in Hekaya Studio.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 30 } }, additionalProperties: false }, _meta: { securitySchemes: [{ type: "oauth2", scopes: ["hekaya:use"] }] } }
];
const valid = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
async function readBody(req) {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 100000) throw new Error("Request too large"); }
  return JSON.parse(raw || "{}");
}

const BASE = "https://vid-ali-b36b.vercel.app";
const RESOURCE = BASE + "/api/mcp";
const ISSUER = BASE;
const b64 = (n = 32) => randomBytes(n).toString("base64url");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const safeEqual = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
async function ensureOAuth(db) {
  await db.batch([
    "CREATE TABLE IF NOT EXISTS oauth_clients (client_id TEXT PRIMARY KEY, client_name TEXT NOT NULL, redirect_uris TEXT NOT NULL, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS oauth_codes (code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, code_challenge TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL, expires_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS oauth_access_tokens (token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL, expires_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL, expires_at INTEGER NOT NULL)"
  ], "write");
}
async function authorized(req) {
  const supplied = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!supplied) return false;
  let db;
  try {
    db = await getDb();
    await ensureOAuth(db);
    if (/^hk_[A-Za-z0-9_-]{40,100}$/.test(supplied)) {
      const result = await db.execute("SELECT token_hash FROM mcp_tokens WHERE id = 1");
      return safeEqual(hash(supplied), String(result.rows[0]?.token_hash || ""));
    }
    const result = await db.execute({sql:"SELECT resource, expires_at FROM oauth_access_tokens WHERE token_hash = ?",args:[hash(supplied)]});
    const row = result.rows[0];
    return Boolean(row && row.resource === RESOURCE && Number(row.expires_at) > Date.now());
  } catch { return false; }
  finally { db?.close(); }
}

async function getDb() {
  const url = process.env.TURSO_DATABASE_URL || "";
  const token = process.env.TURSO_AUTH_TOKEN || "";
  if (!url || !token) throw new Error("Hekaya database is not configured.");
  return createClient({ url, authToken: token });
}
async function getKieKeys(db) {
  let keys = [];
  try {
    const result = await db.execute("SELECT id, secret FROM kie_api_keys ORDER BY created_at ASC");
    keys = result.rows.map((r) => ({ id: String(r.id), secret: String(r.secret) }));
  } catch {}
  if (!keys.length && process.env.KIE_API_KEYS) {
    const parsed = JSON.parse(process.env.KIE_API_KEYS);
    keys = Array.isArray(parsed) ? parsed.map((v, i) => typeof v === "string" ? ({ id: "env-" + i, secret: v }) : ({ id: v.id || "env-" + i, secret: v.secret })).filter((v) => typeof v.secret === "string" && v.secret.length) : [];
  }
  if (!keys.length) throw new Error("No Kie.ai key is configured in Hekaya.");
  return keys;
}
async function kieCreate(db, model, input) {
  const keys = await getKieKeys(db);
  let last = "Kie.ai request failed";
  for (const key of keys) {
    const response = await fetch("https://api.kie.ai/api/v1/jobs/createTask", { method: "POST", headers: { Authorization: "Bearer " + key.secret, "Content-Type": "application/json" }, body: JSON.stringify({ model, input }) });
    const data = await response.json().catch(() => ({}));
    if (response.ok && Number(data.code) === 200 && data.data?.taskId) return { taskId: data.data.taskId, model };
    last = data.msg || last;
    if (![401, 429].includes(Number(data.code || response.status))) break;
  }
  throw new Error(last);
}
async function callTool(name, args) {
  const db = await getDb();
  try {
    if (name === "hekaya_generate_image") {
      if (!valid(args.prompt, 4000)) throw new Error("prompt is required.");
      const result = await kieCreate(db, "gpt-image-2-6/flare-text-to-image", { prompt: args.prompt.trim(), aspect_ratio: ["9:16", "16:9", "1:1"].includes(args.aspectRatio) ? args.aspectRatio : "9:16", resolution: "1K", quality: "medium", background: "auto", output_format: "png" });
      return textResult(result);
    }
    if (name === "hekaya_generate_video") {
      if (!valid(args.prompt, 4000) || !valid(args.imageUrl, 2000) || !/^https:\/\//i.test(args.imageUrl)) throw new Error("prompt and a public HTTPS imageUrl are required.");
      const result = await kieCreate(db, "grok-imagine-video-1-5-preview", { prompt: args.prompt.trim(), image_urls: [args.imageUrl], aspect_ratio: "9:16", resolution: "480p", duration: 8 });
      return textResult(result);
    }
    if (name === "hekaya_check_generation") {
      if (!valid(args.taskId, 200)) throw new Error("taskId is required.");
      const keys = await getKieKeys(db);
      let data;
      for (const key of keys) {
        const response = await fetch("https://api.kie.ai/api/v1/jobs/recordInfo?taskId=" + encodeURIComponent(args.taskId), { headers: { Authorization: "Bearer " + key.secret } });
        data = await response.json().catch(() => ({}));
        if (response.ok && Number(data.code) === 200) break;
      }
      const task = data?.data || {};
      let resultJson = {};
      try { resultJson = typeof task.resultJson === "string" ? JSON.parse(task.resultJson) : (task.resultJson || {}); } catch {}
      return textResult({ taskId: args.taskId, state: task.state || "unknown", progress: task.progress ?? null, resultUrls: resultJson.resultUrls || [], failMsg: task.failMsg || "" });
    }
    if (name === "hekaya_save_draft") {
      if (!valid(args.title, 160) || !valid(args.topic || "قصة قصيرة", 2000) || !valid(args.story, 30000)) throw new Error("title, topic and story are required.");
      const id = randomUUID(); const now = new Date().toISOString();
      const platforms = Array.isArray(args.platforms) ? args.platforms.filter((p) => typeof p === "string").slice(0, 4) : [];
      await db.execute({ sql: "INSERT INTO drafts (id,title,topic,story,platforms_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", args: [id,args.title.trim(),(args.topic || "قصة قصيرة").trim(),args.story,JSON.stringify(platforms),now,now] });
      return textResult({ saved: true, id, title: args.title });
    }
    if (name === "hekaya_list_drafts") {
      const limit = Math.min(30, Math.max(1, Number.isInteger(args.limit) ? args.limit : 10));
      const result = await db.execute({ sql: "SELECT id,title,topic,story,platforms_json,created_at FROM drafts ORDER BY created_at DESC LIMIT ?", args: [limit] });
      return textResult(result.rows.map((r) => ({ id:r.id,title:r.title,topic:r.topic,story:r.story,platforms:JSON.parse(r.platforms_json || "[]"),createdAt:r.created_at })));
    }
    throw new Error("Unknown tool: " + name);
  } finally { db.close(); }
}

const html = (res, status, body) => { res.statusCode=status; res.setHeader("content-type","text/html; charset=utf-8"); res.setHeader("cache-control","no-store"); res.end(body); };
const redirect = (res, url) => { res.statusCode=302; res.setHeader("location",url); res.setHeader("cache-control","no-store"); res.end(); };
const formBody = async (req) => { let raw=""; for await (const c of req) { raw+=c; if(raw.length>20000) throw new Error("Request too large"); } return Object.fromEntries(new URLSearchParams(raw)); };
const page = (title, body) => `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui;background:#f4f7f3;margin:0;display:grid;place-items:center;min-height:100vh;color:#17221d}.card{background:white;padding:28px;border-radius:18px;width:min(420px,calc(100% - 40px));box-shadow:0 12px 40px #0001}input,button{font:inherit;width:100%;box-sizing:border-box;padding:13px;margin-top:12px;border:1px solid #dce5dc;border-radius:9px}button{background:#176b4a;color:white;border:0;font-weight:700;cursor:pointer}.muted{color:#69746c;font-size:14px;line-height:1.8}</style><main class="card"><h2>${title}</h2>${body}</main></html>`;
async function oauth(req,res,url) {
  const path=url.pathname;
  if (req.method==="GET" && (path==="/.well-known/oauth-protected-resource" || path==="/.well-known/oauth-protected-resource/api/mcp" || path==="/api/mcp/.well-known/oauth-protected-resource")) {
    return json(res,200,{resource:RESOURCE,authorization_servers:[ISSUER],scopes_supported:["hekaya:use"],resource_documentation:BASE});
  }
  if (req.method==="GET" && (path==="/.well-known/oauth-authorization-server" || path==="/api/mcp/.well-known/oauth-authorization-server")) {
    return json(res,200,{issuer:ISSUER,authorization_endpoint:BASE+"/api/mcp/authorize",token_endpoint:BASE+"/api/mcp/token",registration_endpoint:BASE+"/api/mcp/register",response_types_supported:["code"],grant_types_supported:["authorization_code","refresh_token"],code_challenge_methods_supported:["S256"],token_endpoint_auth_methods_supported:["none"],scopes_supported:["hekaya:use"]});
  }
  if (path==="/api/mcp/register" && req.method==="POST") {
    const body=await readBody(req);
    const redirects=Array.isArray(body.redirect_uris)?body.redirect_uris:[];
    const validRedirects = redirects.length > 0 && redirects.length <= 10 && redirects.every((value) => {
      if (typeof value !== "string") return false;
      try {
        const target = new URL(value);
        return target.protocol === "https:" || (target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname));
      } catch { return false; }
    });
    if (!validRedirects) return json(res,400,{error:"invalid_redirect_uri"});
    const db=await getDb();
    try {
      await ensureOAuth(db);
      const clientId="hekaya_"+b64(24);
      await db.execute({sql:"INSERT INTO oauth_clients(client_id,client_name,redirect_uris,created_at) VALUES(?,?,?,?)",args:[clientId,String(body.client_name||"ChatGPT MCP client").slice(0,120),JSON.stringify(redirects),new Date().toISOString()]});
      return json(res,201,{client_id:clientId,client_name:String(body.client_name||"ChatGPT MCP client").slice(0,120),redirect_uris:redirects,token_endpoint_auth_method:"none",grant_types:["authorization_code","refresh_token"],response_types:["code"]});
    } finally {db.close();}
  }
  if (path==="/api/mcp/authorize" && req.method==="GET") {
    const p=url.searchParams;
    const clientId=p.get("client_id")||"", redirectUri=p.get("redirect_uri")||"", state=p.get("state")||"";
    const challenge=p.get("code_challenge")||"", method=p.get("code_challenge_method")||"", resource=p.get("resource")||"";
    if(p.get("response_type")!=="code" || !clientId || !redirectUri || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || method!=="S256" || resource!==RESOURCE) return html(res,400,page("طلب OAuth غير صالح",'<p class="muted">راجع إعدادات الاتصال وحاول مرة أخرى.</p>'));
    let db=await getDb();
    let client;
    try { await ensureOAuth(db); const q=await db.execute({sql:"SELECT redirect_uris FROM oauth_clients WHERE client_id=?",args:[clientId]}); client=q.rows[0]; }
    finally {db.close();}
    if(!client || !JSON.parse(client.redirect_uris).includes(redirectUri)) return html(res,400,page("تعذر التحقق من التطبيق",'<p class="muted">بيانات العميل أو رابط العودة غير مسجل.</p>'));
    const hidden={client_id:clientId,redirect_uri:redirectUri,state,code_challenge:challenge,resource};
    const fields=Object.entries(hidden).map(([k,v])=>`<input type="hidden" name="${k}" value="${String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}">`).join("");
    return html(res,200,page("ربط حكاية مع ChatGPT",'<p class="muted">أدخل كلمة مرور دخول استوديو حكاية للسماح لـ ChatGPT باستخدام أدوات حكاية.</p><form method="post" action="/api/mcp/authorize">'+fields+'<label>كلمة مرور حكاية</label><input type="password" name="password" required autocomplete="current-password"><button>موافقة وربط</button></form>'));
  }
  if (path==="/api/mcp/authorize" && req.method==="POST") {
    const p=await formBody(req);
    const expected=Buffer.from(process.env.APP_ACCESS_PASSWORD||"");
    const given=Buffer.from(p.password||"");
    if(!expected.length || !safeEqual(expected.toString("hex"),given.toString("hex"))) return html(res,401,page("كلمة المرور غير صحيحة",'<p class="muted">ارجع للخلف وحاول مرة أخرى.</p>'));
    let db=await getDb();
    try {
      await ensureOAuth(db);
      const q=await db.execute({sql:"SELECT redirect_uris FROM oauth_clients WHERE client_id=?",args:[p.client_id]});
      if(!q.rows[0] || !JSON.parse(q.rows[0].redirect_uris).includes(p.redirect_uri) || p.resource!==RESOURCE) return html(res,400,page("طلب غير صالح",'<p class="muted">تعذر التحقق من بيانات الربط.</p>'));
      const code=b64(32), expires=Date.now()+5*60*1000;
      await db.execute({sql:"INSERT INTO oauth_codes(code_hash,client_id,redirect_uri,code_challenge,resource,scope,expires_at) VALUES(?,?,?,?,?,?,?)",args:[hash(code),p.client_id,p.redirect_uri,p.code_challenge,p.resource,"hekaya:use",expires]});
      const target=new URL(p.redirect_uri); target.searchParams.set("code",code); if(p.state) target.searchParams.set("state",p.state);
      return redirect(res,target.toString());
    } finally {db.close();}
  }
  if(path==="/api/mcp/token" && req.method==="POST") {
    let p;
    const ct=req.headers["content-type"]||"";
    if(ct.includes("application/x-www-form-urlencoded")) p=await formBody(req); else p=await readBody(req);
    const db=await getDb();
    try {
      await ensureOAuth(db);
      if(p.grant_type==="authorization_code") {
        const q=await db.execute({sql:"SELECT * FROM oauth_codes WHERE code_hash=?",args:[hash(String(p.code||""))]});
        const row=q.rows[0];
        await db.execute({sql:"DELETE FROM oauth_codes WHERE code_hash=?",args:[hash(String(p.code||""))]});
        if(!row || Number(row.expires_at)<=Date.now() || row.client_id!==p.client_id || row.redirect_uri!==p.redirect_uri || row.resource!==p.resource || !safeEqual(createHash("sha256").update(String(p.code_verifier||"")).digest("base64url"),row.code_challenge)) return json(res,400,{error:"invalid_grant"});
        const access=b64(36), refresh=b64(48), now=Date.now();
        await db.batch([
          {sql:"INSERT INTO oauth_access_tokens(token_hash,client_id,resource,scope,expires_at) VALUES(?,?,?,?,?)",args:[hash(access),row.client_id,row.resource,row.scope,now+3600000]},
          {sql:"INSERT INTO oauth_refresh_tokens(token_hash,client_id,resource,scope,expires_at) VALUES(?,?,?,?,?)",args:[hash(refresh),row.client_id,row.resource,row.scope,now+30*86400000]}
        ],"write");
        return json(res,200,{access_token:access,token_type:"Bearer",expires_in:3600,refresh_token:refresh,scope:row.scope});
      }
      if(p.grant_type==="refresh_token") {
        const q=await db.execute({sql:"SELECT * FROM oauth_refresh_tokens WHERE token_hash=?",args:[hash(String(p.refresh_token||""))]});
        const row=q.rows[0];
        if(!row || Number(row.expires_at)<=Date.now() || row.client_id!==p.client_id || row.resource!==p.resource) return json(res,400,{error:"invalid_grant"});
        await db.execute({sql:"DELETE FROM oauth_refresh_tokens WHERE token_hash=?",args:[hash(String(p.refresh_token))]});
        const access=b64(36), refresh=b64(48), now=Date.now();
        await db.batch([
          {sql:"INSERT INTO oauth_access_tokens(token_hash,client_id,resource,scope,expires_at) VALUES(?,?,?,?,?)",args:[hash(access),row.client_id,row.resource,row.scope,now+3600000]},
          {sql:"INSERT INTO oauth_refresh_tokens(token_hash,client_id,resource,scope,expires_at) VALUES(?,?,?,?,?)",args:[hash(refresh),row.client_id,row.resource,row.scope,now+30*86400000]}
        ],"write");
        return json(res,200,{access_token:access,token_type:"Bearer",expires_in:3600,refresh_token:refresh,scope:row.scope});
      }
      return json(res,400,{error:"unsupported_grant_type"});
    } finally {db.close();}
  }
  return false;
}
export default async function handler(req, res) {
  const url=new URL(req.url,"https://vid-ali-b36b.vercel.app");
  try {
    const oauthResult=await oauth(req,res,url);
    if(oauthResult!==false) return oauthResult;
  } catch(error) { return json(res,500,{error:"OAuth service unavailable"}); }
  if(req.method!=="POST") return json(res,405,{error:"Use POST for the MCP Streamable HTTP endpoint."},{allow:"POST"});
  let body;
  try {body=await readBody(req);} catch {return json(res,400,{error:"Invalid JSON-RPC request"});}
  if(body.method==="notifications/initialized" || body.method?.startsWith("notifications/")) return res.end();
  const id=body.id??null;
  const reply=(result)=>json(res,200,{jsonrpc:"2.0",id,result});
  const fail=(code,message)=>json(res,200,{jsonrpc:"2.0",id,error:{code,message}});
  if(body.jsonrpc!=="2.0" || !body.method) return fail(-32600,"Invalid Request");
  if(body.method==="initialize") return reply({protocolVersion:"2025-03-26",capabilities:{tools:{}},serverInfo:{name:"hekaya-studio",version:"1.1.0"}});
  if(body.method==="ping") return reply({});
  if(body.method==="tools/list") return reply({tools});
  if(body.method==="tools/call") {
    if(!(await authorized(req))) return reply({content:[{type:"text",text:"سجّل الدخول لربط حكاية واستخدام الأدوات."}],isError:true,_meta:{"mcp/www_authenticate":['Bearer resource_metadata="https://vid-ali-b36b.vercel.app/.well-known/oauth-protected-resource", error="invalid_token", error_description="OAuth authorization is required"']}});
    const name=body.params?.name;
    if(!tools.some(t=>t.name===name)) return fail(-32602,"Unknown tool");
    try {return reply(await callTool(name,body.params?.arguments||{}));}
    catch(error){return reply(textResult(error.message||"Tool failed",true));}
  }
  return fail(-32601,"Method not found");
}
