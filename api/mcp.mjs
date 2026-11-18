import { createClient } from "@libsql/client";
import { randomUUID, timingSafeEqual } from "node:crypto";

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
  { name: "hekaya_generate_image", description: "Generate a vertical story image with the configured Kie.ai account.", inputSchema: { type: "object", properties: { prompt: { type: "string", maxLength: 4000 }, aspectRatio: { type: "string", enum: ["9:16", "16:9", "1:1"] } }, required: ["prompt"], additionalProperties: false } },
  { name: "hekaya_generate_video", description: "Animate a generated image into an 8-second vertical video. Supply a public HTTPS image URL.", inputSchema: { type: "object", properties: { prompt: { type: "string", maxLength: 4000 }, imageUrl: { type: "string", maxLength: 2000 } }, required: ["prompt", "imageUrl"], additionalProperties: false } },
  { name: "hekaya_check_generation", description: "Check a Kie.ai image or video generation task and retrieve its result URLs.", inputSchema: { type: "object", properties: { taskId: { type: "string", maxLength: 200 } }, required: ["taskId"], additionalProperties: false } },
  { name: "hekaya_save_draft", description: "Save a story draft in Hekaya Studio.", inputSchema: { type: "object", properties: { title: { type: "string", maxLength: 160 }, topic: { type: "string", maxLength: 2000 }, story: { type: "string", maxLength: 30000 }, platforms: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 4 } }, required: ["title", "topic", "story"], additionalProperties: false } },
  { name: "hekaya_list_drafts", description: "List the latest saved story drafts in Hekaya Studio.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 30 } }, additionalProperties: false } }
];
const valid = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
async function readBody(req) {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 100000) throw new Error("Request too large"); }
  return JSON.parse(raw || "{}");
}
function authorized(req) {
  const expected = process.env.HEKAYA_MCP_TOKEN || "";
  const supplied = (req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
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
      if (!valid(args.prompt, 4000) || !valid(args.imageUrl, 2000) || !/^https:\\/\\//i.test(args.imageUrl)) throw new Error("prompt and a public HTTPS imageUrl are required.");
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
export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Use POST for the MCP Streamable HTTP endpoint." }, { allow: "POST" });
  if (!authorized(req)) return json(res, 401, { error: "Unauthorized" }, { "www-authenticate": 'Bearer realm="Hekaya MCP"' });
  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: "Invalid JSON-RPC request" }); }
  if (body.method === "notifications/initialized" || body.method?.startsWith("notifications/")) return res.end();
  const id = body.id ?? null;
  const reply = (result) => json(res, 200, { jsonrpc: "2.0", id, result });
  const fail = (code, message) => json(res, 200, { jsonrpc: "2.0", id, error: { code, message } });
  if (body.jsonrpc !== "2.0" || !body.method) return fail(-32600, "Invalid Request");
  if (body.method === "initialize") return reply({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "hekaya-studio", version: "1.0.0" } });
  if (body.method === "ping") return reply({});
  if (body.method === "tools/list") return reply({ tools });
  if (body.method === "tools/call") {
    const name = body.params?.name;
    if (!tools.some((t) => t.name === name)) return fail(-32602, "Unknown tool");
    try { return reply(await callTool(name, body.params?.arguments || {})); }
    catch (error) { return reply(textResult(error.message || "Tool failed", true)); }
  }
  return fail(-32601, "Method not found");
}
