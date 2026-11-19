import { createClient } from "@libsql/client";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { send } from "@vercel/queue";
const TOPIC = "hekaya-video-scenes";
const db = () => {
  const url=process.env.TURSO_DATABASE_URL||"", authToken=process.env.TURSO_AUTH_TOKEN||"";
  if(!url||!authToken) throw Object.assign(new Error("Turso database is not configured."),{status:503});
  return createClient({url,authToken});
};
const json=(res,status,body)=>{res.statusCode=status;res.setHeader("content-type","application/json; charset=utf-8");res.setHeader("cache-control","no-store");res.end(JSON.stringify(body));};
function authorized(req){
  const secret=process.env.APP_SESSION_SECRET||"", password=process.env.APP_ACCESS_PASSWORD||"";
  if(!secret||!password)return false;
  const match=(req.headers.cookie||"").match(/(?:^|;\s*)hekaya_session=([^;]+)/);
  if(!match)return false;
  const [expires,signature]=decodeURIComponent(match[1]).split(".");
  if(!/^\d+$/.test(expires||"")||Number(expires)<=Date.now()||!signature)return false;
  const expected=createHmac("sha256",secret).update(expires).digest("hex"),a=Buffer.from(signature),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
async function ensureSchema(c){
  await c.batch([
    "CREATE TABLE IF NOT EXISTS video_queues (id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',total_scenes INTEGER NOT NULL,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS video_queue_scenes (id TEXT PRIMARY KEY,queue_id TEXT NOT NULL,scene_order INTEGER NOT NULL,prompt TEXT NOT NULL,image_url TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',task_id TEXT,video_url TEXT,attempts INTEGER NOT NULL DEFAULT 0,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(queue_id,scene_order))",
    "CREATE INDEX IF NOT EXISTS video_queue_scenes_order_idx ON video_queue_scenes(queue_id,scene_order)",
    "CREATE INDEX IF NOT EXISTS video_queues_created_idx ON video_queues(created_at DESC)"
  ],"write");
}
async function readBody(req){
  let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>150000)throw Object.assign(new Error("Payload too large."),{status:413});}
  try{return JSON.parse(raw||"{}");}catch{throw Object.assign(new Error("Invalid JSON body."),{status:400});}
}
export default async function handler(req,res){
  if(!authorized(req))return json(res,401,{error:"سجّل الدخول إلى حكاية أولاً."});
  let c;
  try{
    c=db();await ensureSchema(c);
    if(req.method==="GET"){
      const queueId=new URL(req.url,"https://hekaya.local").searchParams.get("queueId");
      if(!queueId){const r=await c.execute("SELECT id,title,status,total_scenes,error,created_at,updated_at FROM video_queues ORDER BY created_at DESC LIMIT 20");return json(res,200,{queues:r.rows});}
      const q=await c.execute({sql:"SELECT id,title,status,total_scenes,error,created_at,updated_at FROM video_queues WHERE id=?",args:[queueId]});
      if(!q.rows[0])return json(res,404,{error:"Queue not found."});
      const s=await c.execute({sql:"SELECT id,scene_order,status,task_id,video_url,attempts,error FROM video_queue_scenes WHERE queue_id=? ORDER BY scene_order",args:[queueId]});
      return json(res,200,{queue:q.rows[0],scenes:s.rows});
    }
    if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});
    const body=await readBody(req);
    if(!Array.isArray(body.scenes)||body.scenes.length<1||body.scenes.length>20)return json(res,400,{error:"أرسل من 1 إلى 20 مشهداً."});
    const scenes=body.scenes.map((s,i)=>({order:i+1,prompt:typeof s.prompt==="string"?s.prompt.trim():"",imageUrl:typeof s.imageUrl==="string"?s.imageUrl.trim():""}));
    if(scenes.some(s=>!s.prompt||s.prompt.length>4000||!/^https:\/\//i.test(s.imageUrl)||s.imageUrl.length>2000))return json(res,400,{error:"كل مشهد يحتاج وصفاً صالحاً ورابط صورة HTTPS."});
    const id=randomUUID(),now=new Date().toISOString();
    await c.execute({sql:"INSERT INTO video_queues(id,title,status,total_scenes,created_at,updated_at) VALUES(?,?,'queued',?,?,?)",args:[id,String(body.title||"مشروع فيديو").slice(0,160),scenes.length,now,now]});
    await c.batch(scenes.map(s=>({sql:"INSERT INTO video_queue_scenes(id,queue_id,scene_order,prompt,image_url,status,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?)",args:[randomUUID(),id,s.order,s.prompt,s.imageUrl,now,now]})),"write");
    try{await send(TOPIC,{queueId:id},{idempotencyKey:"hekaya:"+id+":start",retentionSeconds:604800});}
    catch(error){await c.execute({sql:"UPDATE video_queues SET status='enqueue_failed',error=?,updated_at=? WHERE id=?",args:[String(error.message||error).slice(0,500),new Date().toISOString(),id]});throw error;}
    return json(res,202,{ok:true,queueId:id,status:"queued",scenes:scenes.length});
  }catch(error){return json(res,error.status||500,{error:error.status?error.message:"تعذر إنشاء طابور الفيديو. راجع اتصال Turso وVercel Queues."});}
  finally{c?.close();}
}
