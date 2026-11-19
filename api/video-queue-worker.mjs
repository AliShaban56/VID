import { createClient } from "@libsql/client";
import { handleCallback, send } from "@vercel/queue";
const TOPIC="hekaya-video-scenes";
const db=()=>createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});
async function agnesRequest(c,path,payload){
  await c.execute("CREATE TABLE IF NOT EXISTS agnes_multi_keys (id TEXT PRIMARY KEY,label TEXT NOT NULL,secret TEXT NOT NULL,created_at TEXT NOT NULL)");
  const r=await c.execute("SELECT id,secret FROM agnes_multi_keys ORDER BY created_at ASC"),keys=r.rows.map(x=>({id:String(x.id),secret:String(x.secret)}));
  if(!keys.length)throw new Error("No Agnes AI keys are configured in Hekaya Settings.");
  await c.execute("CREATE TABLE IF NOT EXISTS agnes_key_rotation (id INTEGER PRIMARY KEY CHECK(id=1),next_index INTEGER NOT NULL DEFAULT 0)");
  await c.execute("INSERT OR IGNORE INTO agnes_key_rotation(id,next_index) VALUES(1,0)");
  const n=await c.execute({sql:"UPDATE agnes_key_rotation SET next_index=(next_index+1)%? WHERE id=1 RETURNING (next_index+?-1)%? AS idx",args:[keys.length,keys.length,keys.length]});
  const start=Number(n.rows[0]?.idx||0);let lastStatus=502,lastMessage="Agnes AI request failed.";
  for(let i=0;i<keys.length;i++){
    const key=keys[(start+i)%keys.length];let response,data;
    try{response=await fetch("https://apihub.agnes-ai.com"+path,{method:payload===undefined?"GET":"POST",headers:{authorization:"Bearer "+key.secret,"content-type":"application/json"},...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:AbortSignal.timeout(45000)});data=await response.json().catch(()=>({}));}
    catch(e){lastMessage=e.message||lastMessage;continue;}
    if(response.ok)return data;
    lastStatus=response.status;lastMessage=data.error?.message||data.message||String(data.error||lastMessage);
    if(![401,403,402,429].includes(response.status)&&response.status<500)break;
  }
  const e=new Error(lastMessage);e.status=lastStatus;throw e;
}
const taskOf=d=>d.data||d.result||d.task||d;
const urlOf=(t,d)=>t.url||t.video_url||t.videoUrl||t.output?.url||t.output?.video_url||t.result?.url||t.result?.video_url||d.url||d.video_url||null;
const failed=s=>["failed","error","cancelled","canceled"].includes(String(s||"").toLowerCase());
async function again(queueId,key,delaySeconds=0){await send(TOPIC,{queueId},{delaySeconds,idempotencyKey:"hekaya:"+queueId+":"+key,retentionSeconds:604800});}
async function run(message){
  if(!message?.queueId)throw new Error("Missing queueId.");
  const c=db();
  try{
    const q=await c.execute({sql:"SELECT id,status FROM video_queues WHERE id=?",args:[message.queueId]});
    if(!q.rows[0]||["completed","failed"].includes(q.rows[0].status))return;
    const r=await c.execute({sql:"SELECT * FROM video_queue_scenes WHERE queue_id=? AND status NOT IN ('completed','failed') ORDER BY scene_order LIMIT 1",args:[message.queueId]});
    const s=r.rows[0],now=new Date().toISOString();
    if(!s){
      const f=await c.execute({sql:"SELECT COUNT(*) AS n FROM video_queue_scenes WHERE queue_id=? AND status='failed'",args:[message.queueId]});
      await c.execute({sql:"UPDATE video_queues SET status=?,updated_at=? WHERE id=?",args:[Number(f.rows[0]?.n||0)?"failed":"completed",now,message.queueId]});return;
    }
    if(s.status==="queued"){
      const claim=await c.execute({sql:"UPDATE video_queue_scenes SET status='starting',attempts=attempts+1,error=NULL,updated_at=? WHERE id=? AND status='queued' RETURNING attempts",args:[now,s.id]});
      if(!claim.rows.length){await again(message.queueId,"wait:"+s.id+":"+Math.floor(Date.now()/20000),20);return;}
      await c.execute({sql:"UPDATE video_queues SET status='processing',updated_at=? WHERE id=?",args:[now,message.queueId]});
      try{
        const d=await agnesRequest(c,"/v1/videos",{model:"agnes-video-2.5-flash",prompt:s.prompt,mode:"keyframe",first_frame:s.image_url,seconds:"8",size:"720P",aspect_ratio:"9:16",n:1});
        const taskId=d.video_id||d.id||d.task_id||d.data?.video_id||d.data?.id||d.data?.task_id;
        if(!taskId)throw new Error("Agnes AI did not return a task ID.");
        await c.execute({sql:"UPDATE video_queue_scenes SET status='processing',task_id=?,updated_at=? WHERE id=?",args:[String(taskId),new Date().toISOString(),s.id]});
        await again(message.queueId,"poll:"+s.id+":"+claim.rows[0].attempts,25);
      }catch(e){
        const attempts=Number(claim.rows[0].attempts||1);
        if(attempts<4&&(e.status===429||e.status>=500||!e.status)){
          await c.execute({sql:"UPDATE video_queue_scenes SET status='queued',error=?,updated_at=? WHERE id=?",args:[String(e.message||e).slice(0,500),new Date().toISOString(),s.id]});
          await again(message.queueId,"retry:"+s.id+":"+attempts,Math.min(180,30*attempts));
        }else{
          await c.execute({sql:"UPDATE video_queue_scenes SET status='failed',error=?,updated_at=? WHERE id=?",args:[String(e.message||e).slice(0,500),new Date().toISOString(),s.id]});
          await c.execute({sql:"UPDATE video_queues SET status='failed',error=?,updated_at=? WHERE id=?",args:["Scene "+s.scene_order+" failed: "+String(e.message||e).slice(0,350),new Date().toISOString(),message.queueId]});
        }
      }return;
    }
    if(s.status==="starting"){
      const age=Date.now()-new Date(s.updated_at).getTime();
      if(age<120000){await again(message.queueId,"starting:"+s.id+":"+Math.floor(Date.now()/30000),25);return;}
      await c.execute({sql:"UPDATE video_queue_scenes SET status='queued',error='Recovered stale generation claim',updated_at=? WHERE id=? AND status='starting'",args:[now,s.id]});
      await again(message.queueId,"recover:"+s.id+":"+Math.floor(Date.now()/120000),5);return;
    }
    if(s.status==="processing"&&s.task_id){
      let d;try{d=await agnesRequest(c,"/agnesapi?video_id="+encodeURIComponent(s.task_id)+"&model_name=agnes-video-2.5-flash",undefined);}
      catch{await again(message.queueId,"pollretry:"+s.id+":"+Math.floor(Date.now()/30000),45);return;}
      const t=taskOf(d),u=urlOf(t,d),state=String(t.status||t.state||d.status||"processing").toLowerCase();
      if(u&&/^https:\/\//i.test(u)){
        await c.execute({sql:"UPDATE video_queue_scenes SET status='completed',video_url=?,error=NULL,updated_at=? WHERE id=? AND status='processing'",args:[u,new Date().toISOString(),s.id]});
        await again(message.queueId,"advance:"+s.id,0);
      }else if(failed(state)){
        if(Number(s.attempts||1)<4){
          await c.execute({sql:"UPDATE video_queue_scenes SET status='queued',task_id=NULL,error=?,updated_at=? WHERE id=?",args:[String(t.error||t.message||"Agnes generation failed").slice(0,500),new Date().toISOString(),s.id]});
          await again(message.queueId,"retryfailed:"+s.id+":"+s.attempts,45);
        }else{
          await c.execute({sql:"UPDATE video_queue_scenes SET status='failed',error=?,updated_at=? WHERE id=?",args:[String(t.error||t.message||"Agnes generation failed").slice(0,500),new Date().toISOString(),s.id]});
          await c.execute({sql:"UPDATE video_queues SET status='failed',error=?,updated_at=? WHERE id=?",args:["Scene "+s.scene_order+" failed",new Date().toISOString(),message.queueId]});
        }
      }else await again(message.queueId,"poll:"+s.id+":"+Math.floor(Date.now()/30000),30);
      return;
    }
    await again(message.queueId,"resume:"+s.id+":"+Math.floor(Date.now()/30000),20);
  }finally{c.close();}
}
export const POST=handleCallback(async(message,metadata)=>{
  try{await run(message);}
  catch(e){console.error("Hekaya queue error",{queueId:message?.queueId,deliveryCount:metadata?.deliveryCount,error:e.message});throw e;}
},{visibilityTimeoutSeconds:180,retry:(_e,m)=>({afterSeconds:Math.min(300,15*Math.max(1,m.deliveryCount||1))})});
