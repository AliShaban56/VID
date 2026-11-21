import { init } from './_db.js';
import { timingSafeEqual } from 'node:crypto';

const tokenValue = () => process.env.HEKAYA_MCP_TOKEN || '';
function authorized(req) {
  const expected = tokenValue();
  const header = String(req.headers?.authorization || '');
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
const tool = (name, description, inputSchema, readOnly=true) => ({
  name, description, inputSchema,
  annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false }
});
const tools = [
  tool('hekaya_health', 'Use this read-only tool to test Hekaya MCP authentication and server readiness.', {type:'object',properties:{},additionalProperties:false}),
  tool('hekaya_list_projects', 'Use this read-only tool to list Hekaya projects from the connected database.', {type:'object',properties:{},additionalProperties:false}),
  tool('hekaya_get_library', 'Use this read-only tool to retrieve Hekaya project scenes and generated assets.', {type:'object',properties:{},additionalProperties:false})
];
function reply(res, id, result) { return res.status(200).json({jsonrpc:'2.0',id,result}); }
function err(res,id,code,message) { return res.status(200).json({jsonrpc:'2.0',id,error:{code,message}}); }
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Access-Control-Allow-Origin','https://chatgpt.com');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!authorized(req)) return res.status(401).json({error:'Unauthorized MCP access'});
  const body=req.body||{};
  const id=body.id;
  if(body.method==='initialize') return reply(res,id,{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'Hekaya Studio MCP',version:'0.1.0'}});
  if(body.method==='notifications/initialized') return res.status(202).end();
  if(body.method==='tools/list') return reply(res,id,{tools});
  if(body.method==='tools/call') {
    const name=body.params?.name;
    try {
      if(name==='hekaya_health') return reply(res,id,{content:[{type:'text',text:'Hekaya MCP authenticated. Database connectivity is checked on database tools.'}]});
      if(name==='hekaya_list_projects') {
        const d=await init(req);
        const result=await d.execute('SELECT id,title,updated_at FROM projects ORDER BY updated_at DESC LIMIT 100');
        return reply(res,id,{content:[{type:'text',text:JSON.stringify(result.rows)}],structuredContent:{projects:result.rows}});
      }
      if(name==='hekaya_get_library') {
        const d=await init(req);
        const [projects,scenes,jobs]=await Promise.all([
          d.execute('SELECT id,title,updated_at FROM projects ORDER BY updated_at DESC LIMIT 100'),
          d.execute('SELECT id,project_id,position,text,image_prompt,video_prompt,image_url,video_url,status,updated_at FROM scenes ORDER BY project_id,position LIMIT 500'),
          d.execute('SELECT id,project_id,scene_id,kind,model,status,result_url,error,created_at FROM generation_jobs ORDER BY created_at DESC LIMIT 500')
        ]);
        const result={projects:projects.rows||[],scenes:scenes.rows||[],jobs:jobs.rows||[]};
        return reply(res,id,{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result});
      }
      return err(res,id,-32601,'Unknown tool');
    } catch(e) { return err(res,id,-32000,e?.message||'Tool failed'); }
  }
  if(body.method==='ping') return reply(res,id,{});
  return err(res,id,-32601,'Method not supported');
}