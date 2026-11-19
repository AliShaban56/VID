(() => {
const IMAGES=[
"https://platform-outputs.agnes-ai.space/images/t2i/task_AJnCG9w1oiVO1CCpTE7hmSBhBcoHtL9F/output_30f018dca5294e9488cca3c141a8f1f2.png",
"https://platform-outputs.agnes-ai.space/images/t2i/task_pVHJXThqucouoTxEyqt4jklss3qp2ol3/output_277c6070844248c291844ef9413acdf9.png",
"https://platform-outputs.agnes-ai.space/images/t2i/task_K0PxPet2eSypVjWB5p1SBlf7dC9YuXMO/output_bed36b9eba9847429c1b4f83c3eb231c.png",
"https://platform-outputs.agnes-ai.space/images/t2i/task_T2cfpnio7DRlFvVrjWhG6hr6b6TyLIDU/output_1d04dc46000b4d7f85265731081da5ee.png",
"https://platform-outputs.agnes-ai.space/images/t2i/task_DBnFUlFTakfyuKrhZJmklv86xf0dNpPK/output_1309e319fdc14933a9a8a12bca7c7456.png",
"https://platform-outputs.agnes-ai.space/images/t2i/task_3JVlcogdJ1Wqft8J6IYrKNQPgAP9flUx/output_c76b58dd769c4836ad26ded4c8a49907.png",
"https://platform-outputs.agnes-ai.space/images/t2i/task_EBEj56lHlOVAaGxp4V3mGIXKmvhSNbum/output_52e3b139a4b248a2b04b370eede334af.png",
"https://platform-outputs.agnes-ai.space/images/t2i/task_gcYPyTrvQEpWWnTgUHipvCUrkHvwjGfM/output_2d64cf87f46f4cb0a87d5d89a0773250.png"
];
const PROMPTS=[
"Animate this exact image into an 8-second vertical 9:16 photorealistic cinematic horror shot. Slow camera push toward Yusuf entering the abandoned hotel lobby; rain streaks windows, subtle light flicker, phone begins to vibrate. Preserve exact character identity, clothing, architecture and composition. No cuts, no text, no gore.",
"Animate this exact image into an 8-second vertical 9:16 cinematic horror shot. Very slow push-in on Yusuf holding the antique receiver; tiny hand tremor, slight breathing, his expression shifts to fear, practical light flickers. Preserve face and set exactly. No cuts, no text.",
"Animate this exact image into an 8-second vertical 9:16 photorealistic horror shot. Slow forward dolly down the empty corridor toward door 13; fluorescent lights flicker irregularly, faint haze drifts. Keep architecture and number fixed and legible. No people, no cuts, no added text.",
"Animate this exact image into an 8-second vertical 9:16 photorealistic horror shot. Yusuf's hand slowly approaches the brass handle, hesitates, shadow subtly moves against the wall, slight handheld camera drift. Preserve exact actor and door. No cuts, no text.",
"Animate this exact image into an 8-second vertical 9:16 cinematic horror shot. Camera creeps closer to the cracked mirror; the reflected shadow behind Yusuf slowly tilts its head and smiles while real space stays empty. Keep Yusuf's appearance consistent. No gore, no cuts, no text.",
"Animate this exact image into an 8-second vertical 9:16 cinematic horror shot. Door opens very slowly toward camera, revealing the identical seated Yusuf; subtle camera push, dust in narrow light beam. Maintain both identical faces and outfits. No cuts, no text.",
"Animate this exact image into an 8-second vertical 9:16 photorealistic horror shot. Slow tense orbit of a few degrees around the two identical Yusufs; seated double gradually extends his hand, standing Yusuf freezes. Preserve identities and room. No cuts, no text.",
"Animate this exact image into an 8-second vertical 9:16 cinematic horror shot. CCTV monitor flickers with analog interference; both identical Yusufs slowly turn their eyes toward the camera, then brief static pulse near the end. Preserve monitor framing and image. No cuts, no text."
];
const labels=["البهو","المكالمة","الغرفة 13","الطرقات الثلاث","المرآة","الباب يفتح","النسخة الأخرى","النهاية الصادمة"];
const $=s=>document.querySelector(s);let queueId=localStorage.getItem("hekaya_video_queue_id")||"",timer=null,exporting=false;
async function api(method,body){
 const url="/api/video-queue"+(method==="GET"&&queueId?"?queueId="+encodeURIComponent(queueId):"");
 const r=await fetch(url,{method,headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined,credentials:"same-origin"});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"تعذر الاتصال بالطابور.");return d;
}
function render(scenes,queue){
 const done=scenes.filter(s=>s.status==="completed").length,failed=scenes.filter(s=>s.status==="failed").length;
 $("#progress").style.width=(scenes.length?Math.round(done/scenes.length*100):0)+"%";
 $("#summary").textContent=queue.status==="completed"?"اكتمل تحريك جميع المشاهد. جاري تجهيز ملف MP4…":queue.status==="failed"?"توقف الطابور: "+(queue.error||"راجع إعدادات Agnes AI"):(done+" من "+scenes.length+" مشاهد مكتملة"+(failed?" · "+failed+" فاشلة":"")+" · "+queue.status);
 $("#scenes").innerHTML=scenes.map(s=>{
  const label=labels[s.scene_order-1]||("مشهد "+s.scene_order),status=({queued:"في الانتظار",starting:"بدء الإنشاء",processing:"قيد التحريك",completed:"مكتمل",failed:"فشل"})[s.status]||s.status;
  const detail=s.video_url?'<a target="_blank" rel="noopener" href="'+s.video_url+'">فتح الفيديو الناتج</a>':(s.error||"مقطع مدته 8 ثوانٍ");
  return '<div class="scene"><div class="num">'+s.scene_order+'</div><div><strong>'+label+'</strong><small>'+detail+'</small></div><span class="pill '+s.status+'">'+status+'</span></div>';
 }).join("");
}
async function exportMp4(scenes){
 if(exporting)return;exporting=true;
 if(scenes.length!==8||scenes.some(s=>s.status!=="completed"||!s.video_url))throw new Error("بعض المشاهد لم تكتمل.");
 $("#exportNote").textContent="تحميل محرك FFmpeg وتنزيل المقاطع بالترتيب…";
 const {FFmpeg}=await import("https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js");
 const {toBlobURL}=await import("https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js");
 const ff=new FFmpeg();ff.on("progress",e=>$("#exportNote").textContent="دمج وتصدير MP4: "+Math.round(e.progress*100)+"%");
 const base="https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
 await ff.load({classWorkerURL:new URL("/ffmpeg/worker.js",location.origin).href,coreURL:await toBlobURL(base+"/ffmpeg-core.js","text/javascript"),wasmURL:await toBlobURL(base+"/ffmpeg-core.wasm","application/wasm")});
 const names=[];
 for(let i=0;i<scenes.length;i++){
  $("#exportNote").textContent="تنزيل المشهد "+(i+1)+" من 8…";
  const r=await fetch(scenes[i].video_url);if(!r.ok)throw new Error("تعذر تنزيل المشهد "+(i+1)+"؛ قد يمنع المصدر CORS.");
  await ff.writeFile("in"+i+".mp4",new Uint8Array(await r.arrayBuffer()));
  const out="clip"+i+".mp4";
  await ff.exec(["-i","in"+i+".mp4","-vf","scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p","-an","-c:v","libx264","-preset","ultrafast","-crf","24","-movflags","+faststart",out]);
  names.push(out);await ff.deleteFile("in"+i+".mp4");
 }
 await ff.writeFile("list.txt",new TextEncoder().encode(names.map(n=>"file '"+n+"'").join("\n")));
 await ff.exec(["-f","concat","-safe","0","-i","list.txt","-c","copy","-movflags","+faststart","room-13-final.mp4"]);
 const out=await ff.readFile("room-13-final.mp4"),blob=new Blob([out.buffer],{type:"video/mp4"}),url=URL.createObjectURL(blob),a=$("#download");
 a.href=url;a.download="room-13-final-9x16.mp4";a.classList.add("show");a.textContent="⬇ تنزيل الغرفة 13 — MP4";
 $("#exportNote").textContent="اكتمل الدمج بالترتيب: MP4 عمودي 720×1280، 30fps. اضغط تنزيل لحفظ الملف على جهازك.";
}
async function refresh(){
 if(!queueId)return;
 const d=await api("GET");render(d.scenes,d.queue);
 if(d.queue.status==="completed"){clearInterval(timer);$("#start").disabled=true;if(!exporting)try{await exportMp4(d.scenes);}catch(e){exporting=false;$("#exportNote").textContent="المقاطع اكتملت، لكن تعذر الدمج التلقائي: "+e.message+" — يمكن تنزيلها من الروابط وإضافتها إلى محرر حكاية.";}}
 if(d.queue.status==="failed")clearInterval(timer);
}
async function start(){
 $("#start").disabled=true;$("#summary").textContent="جاري إنشاء الطابور…";
 try{const scenes=IMAGES.map((imageUrl,i)=>({imageUrl,prompt:PROMPTS[i]}));const d=await api("POST",{title:"الغرفة 13 — تحريك المشاهد",scenes});queueId=d.queueId;localStorage.setItem("hekaya_video_queue_id",queueId);await refresh();timer=setInterval(()=>refresh().catch(e=>$("#summary").textContent=e.message),18000);}
 catch(e){$("#summary").textContent=e.message;$("#start").disabled=false;}
}
$("#start").addEventListener("click",start);
$("#refresh").addEventListener("click",()=>refresh().catch(e=>$("#summary").textContent=e.message));
if(queueId){refresh().then(()=>{timer=setInterval(()=>refresh().catch(()=>{}),18000);}).catch(e=>$("#summary").textContent=e.message);}
})();
