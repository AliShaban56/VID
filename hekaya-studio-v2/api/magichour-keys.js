import { init } from './_db.js';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
const secret=()=>process.env.HEKAYA_SECRET_ENCRYPTION_KEY;
function enc(value){const key=createHash('sha256').update(secret()).digest();const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(value,'utf8'),c.final()]);return [iv.toString('base64'),c.getAuthTag().toString('base64'),data.toString('base64')].join('.');}
function dec(value){const [iv,tag,data]=value.split('.');const key=createHash('sha256').update(secret()).digest();const d=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));d.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([d.update(Buffer.from(data,'base64')),d.final()]).toString();}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store'); if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 if(!secret())return res.status(503).json({error:'HEKAYA_SECRET_ENCRYPTION_KEY must be configured in Vercel.'});
 try{const d=await init();const row=await d.execute("SELECT value FROM settings WHERE id='magichour_keys'");
 const stored=row.rows[0]?.value||'[]';let values=JSON.parse(stored).map(dec);
 if(req.method==='GET')return res.status(200).json({count:values.length,keys:values.map((v,i)=>({index:i,label:'Magic Hour key '+(i+1),masked:'••••'+v.slice(-4)}))});
 const action=req.body?.action;
 if(action==='add'){const k=String(req.body?.key||'').trim();if(k.length<12||k.length>500)return res.status(400).json({error:'API key length invalid.'});if(values.includes(k))return res.status(400).json({error:'This key is already saved.'});values.push(k);}
 else if(action==='remove'){const index=Number(req.body?.index);if(!Number.isInteger(index)||index<0||index>=values.length)return res.status(400).json({error:'Invalid key index.'});values.splice(index,1);}
 else if(action==='replace'){const index=Number(req.body?.index),k=String(req.body?.key||'').trim();if(!Number.isInteger(index)||index<0||index>=values.length||k.length<12||k.length>500)return res.status(400).json({error:'Invalid replacement key.'});values[index]=k;}
 else return res.status(400).json({error:'Unknown action'});
 await d.execute({sql:"INSERT INTO settings(id,value,updated_at) VALUES('magichour_keys',?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP",args:[JSON.stringify(values.map(enc))]});
 return res.status(200).json({saved:true,count:values.length});
 }catch(e){return res.status(500).json({error:'Secret storage failed: '+e.message});}
}