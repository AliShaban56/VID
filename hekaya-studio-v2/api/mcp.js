import { init } from './_db.js';

const tools = [
 {name:'hekaya_health',description:'Check Hekaya server and database readiness.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'hekaya_list_projects',description:'List saved Hekaya story projects.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'hekaya_get_library',description:'Read the saved library of project scenes, media links and generation jobs.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'hekaya_get_project_scenes',description:'Read scenes for a project by project ID.',inputSchema:{type:'object',properties:{projectId:{type:'string'}},required:['projectId'],additionalProperties:false},annotations:{readOnlyHint:true}}
];
function response(res,id,result){return res.status(200).json({jsonrpc:'2.0',id,result});}
function error(res,id,code,message){return res.status(200).json({jsonrpc:'2.0',id,error:{code,message}});}
function textResult(data){return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Access-Control-Allow-Origin','https://chatgpt.com');
 res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
 res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, MCP-Protocol-Version');
 if(req.method==='OPTIONS')return res.status(204).end();
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 // This bearer-token implementation is a temporary, private connector prototype,
 // not OAuth and not suitable for broad distribution. Rotate the token if exposed.
 const expected=process.env.HEKAYA_MCP_TOKEN||'',auth=String(req.headers?.authorization||'');
 if(!expected||auth!=='Bearer '+expected)return res.status(401).json({error:'Unauthorized'});
 const b=req.body||{},id=b.id;
 if(b.method==='initialize')return response(res,id,{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'Hekaya Studio MCP',version:'0.2.0'}});
 if(b.method==='notifications/initialized')return res.status(202).end();
 if(b.method==='ping')return response(res,id,{});
 if(b.method==='tools/list')return response(res,id,{tools});
 if(b.method!=='tools/call')return error(res,id,-32601,'Method not supported');
 const name=b.params?.name,args=b.params?.arguments||{};
 try{
  if(name==='hekaya_health'){
   const d=await init(req);await d.execute('SELECT 1');
   return response(res,id,textResult({server:'Hekaya MCP',database:'connected'}));
  }
  const d=await init(req);
  if(name==='hekaya_list_projects'){
   const r=await d.execute('SELECT id,title,substr(story,1,1200) AS story,updated_at FROM projects ORDER BY updated_at DESC LIMIT 50');
   return response(res,id,textResult({projects:r.rows||[]}));
  }
  if(name==='hekaya_get_library'){
   const [p,s,j]=await Promise.all([
    d.execute('SELECT id,title,updated_at FROM projects ORDER BY updated_at DESC LIMIT 50'),
    d.execute('SELECT id,project_id,position,text,image_prompt,video_prompt,image_url,video_url,status,updated_at FROM scenes ORDER BY project_id,position LIMIT 300'),
    d.execute('SELECT id,project_id,scene_id,kind,model,status,result_url,error,created_at FROM generation_jobs ORDER BY created_at DESC LIMIT 300')
   ]);
   return response(res,id,textResult({projects:p.rows||[],scenes:s.rows||[],jobs:j.rows||[]}));
  }
  if(name==='hekaya_get_project_scenes'){
   const pid=String(args.projectId||'').trim();if(!pid||pid.length>200)return error(res,id,-32602,'Invalid projectId');
   const r=await d.execute({sql:'SELECT id,project_id,position,text,image_prompt,video_prompt,image_url,video_url,status,updated_at FROM scenes WHERE project_id=? ORDER BY position LIMIT 100',args:[pid]});
   return response(res,id,textResult({projectId:pid,scenes:r.rows||[]}));
  }
  return error(res,id,-32601,'Unknown tool');
 }catch(e){return error(res,id,-32000,'Hekaya operation failed: '+String(e?.message||e).slice(0,300));}
}
