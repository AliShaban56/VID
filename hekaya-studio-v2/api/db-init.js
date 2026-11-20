import { requireAccess } from './_auth.js';
import {init} from './_db.js';export default async function handler(req,res){if (!requireAccess(req,res)) return;if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});try{await init();return res.status(200).json({ok:true,message:'Schema initialized'});}catch(e){return res.status(500).json({error:e.message});}}
