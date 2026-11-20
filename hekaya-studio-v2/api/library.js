import { requireAccess } from './_auth.js';
import { init } from './_db.js';

export default async function handler(req, res) {
  if (!requireAccess(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const d = await init();
    const [projects, scenes, jobs] = await Promise.all([
      d.execute('SELECT id,title,story,updated_at FROM projects ORDER BY updated_at DESC'),
      d.execute('SELECT id,project_id,position,text,image_prompt,video_prompt,image_url,video_url,status,updated_at FROM scenes ORDER BY project_id,position'),
      d.execute('SELECT id,project_id,scene_id,kind,model,prompt,status,result_url,error,created_at FROM generation_jobs ORDER BY created_at DESC')
    ]);
    const assets = [];
    for (const row of scenes.rows || []) {
      const project = (projects.rows || []).find(p => p.id === row.project_id);
      const title = project?.title || 'مشروع';
      if (row.image_url) assets.push({type:'image',title:title+' — صورة المشهد '+(Number(row.position)+1),url:row.image_url,project:title,projectId:row.project_id,sceneId:row.id});
      if (row.video_url) assets.push({type:'video',title:title+' — فيديو المشهد '+(Number(row.position)+1),url:row.video_url,project:title,projectId:row.project_id,sceneId:row.id});
    }
    for (const row of jobs.rows || []) {
      if (row.result_url && (row.kind==='final-video'||row.kind==='video')) assets.push({type:'video',title:(projects.rows||[]).find(p=>p.id===row.project_id)?.title+' — الفيديو النهائي',url:row.result_url,projectId:row.project_id,project:(projects.rows||[]).find(p=>p.id===row.project_id)?.title||'مشروع',jobId:row.id});
    }
    for (const p of projects.rows || []) assets.push({type:'story',title:p.title||'قصة',project:p.title,url:null,projectId:p.id,excerpt:String(p.story||'').slice(0,400),updatedAt:p.updated_at});
    return res.status(200).json({projects:projects.rows||[],assets,scenes:scenes.rows||[],jobs:jobs.rows||[]});
  } catch (error) {
    return res.status(503).json({error:'تعذر قراءة المكتبة من Turso. تأكد من إعداد TURSO_DATABASE_URL وTURSO_AUTH_TOKEN.',detail:error.message});
  }
}
