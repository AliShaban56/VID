(() => {
  const $ = (s) => document.querySelector(s);
  const filesInput = $("#editorFiles");
  if (!filesInput) return;
  const listEl = $("#editorList"), preview = $("#editorPreview");
  const status = $("#editorStatus"), percent = $("#editorPercent");
  const progress = $("#editorProgress"), exportBtn = $("#exportEditor");
  let clips = [], music = null, ffmpeg = null, outputUrl = "", busy = false;
  const fmt = (n) => { if (!Number.isFinite(n)) return "—"; const m=Math.floor(n/60),s=Math.floor(n%60); return String(m).padStart(2,"0")+":"+String(s).padStart(2,"0"); };
  const esc = (s) => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const totalDuration = () => clips.reduce((n,c)=>n+(c.duration||0),0);
  function setStatus(s,p){status.textContent=s;if(p!==undefined){progress.value=p;percent.textContent=Math.round(p)+"%";}}
  function update(){
    $("#editorCount").textContent=clips.length+" مشاهد";
    $("#editorDuration").textContent=fmt(totalDuration());
    exportBtn.disabled=!clips.length||busy;
    if(!clips.length){listEl.innerHTML='<div class="editor-empty">لسه مفيش مشاهد. ارفع فيديوهاتك أو أضف الفيديو المولّد من حكاية.</div>';return;}
    listEl.innerHTML=clips.map((c,i)=>'<div class="editor-item" draggable="true" data-id="'+c.id+'"><video class="editor-thumb" src="'+c.url+'" muted preload="metadata"></video><div><strong>'+esc(c.name)+'</strong><small>مشهد '+(i+1)+' · '+fmt(c.duration)+'</small></div><div class="editor-item-actions"><button type="button" data-up="'+c.id+'" '+(i===0?'disabled':'')+'>↑</button><button type="button" data-down="'+c.id+'" '+(i===clips.length-1?'disabled':'')+'>↓</button><button type="button" data-remove="'+c.id+'">×</button></div></div>').join("");
  }
  function addFiles(files){
    for(const file of files){if(!file.type.startsWith("video/")&&!/\.(mp4|mov|webm|m4v)$/i.test(file.name))continue;const url=URL.createObjectURL(file);const item={id:crypto.randomUUID(),name:file.name,file,url,duration:0};clips.push(item);const v=document.createElement("video");v.preload="metadata";v.src=url;v.onloadedmetadata=()=>{item.duration=v.duration||0;update();};}
    update();if(clips.length)setStatus("تمت إضافة المشاهد. اسحبها أو استخدم الأسهم لترتيبها.",0);
  }
  filesInput.addEventListener("change",()=>{addFiles([...filesInput.files]);filesInput.value="";});
  $("#editorList").addEventListener("click",e=>{
    const b=e.target.closest("button");if(!b)return;const id=b.dataset.up||b.dataset.down||b.dataset.remove;const i=clips.findIndex(c=>c.id===id);if(i<0)return;
    if(b.dataset.remove){URL.revokeObjectURL(clips[i].url);clips.splice(i,1);}
    else if(b.dataset.up&&i>0)[clips[i-1],clips[i]]=[clips[i],clips[i-1]];
    else if(b.dataset.down&&i<clips.length-1)[clips[i+1],clips[i]]=[clips[i],clips[i+1]];
    update();
  });
  let dragId=null;
  listEl.addEventListener("dragstart",e=>{const row=e.target.closest(".editor-item");if(!row)return;dragId=row.dataset.id;row.classList.add("dragging");e.dataTransfer.effectAllowed="move";});
  listEl.addEventListener("dragend",e=>e.target.closest(".editor-item")?.classList.remove("dragging"));
  listEl.addEventListener("dragover",e=>{if(e.target.closest(".editor-item"))e.preventDefault();});
  listEl.addEventListener("drop",e=>{e.preventDefault();const target=e.target.closest(".editor-item");if(!target||!dragId||target.dataset.id===dragId)return;const from=clips.findIndex(c=>c.id===dragId),to=clips.findIndex(c=>c.id===target.dataset.id);const [item]=clips.splice(from,1);clips.splice(to,0,item);dragId=null;update();});
  $("#clearEditor").addEventListener("click",()=>{if(busy)return;clips.forEach(c=>URL.revokeObjectURL(c.url));clips=[];update();preview.removeAttribute("src");preview.load();$("#editorPreviewEmpty").hidden=false;setStatus("تم مسح قائمة المشاهد.",0);});
  $("#addGeneratedVideo").addEventListener("click",async()=>{
    const src=$("#kieGeneratedVideo")?.currentSrc||$("#kieGeneratedVideo")?.src;
    if(!src||src==="") {setStatus("ولّد فيديو من قسم إنشاء محتوى أولًا.",0);return;}
    try{setStatus("جاري استيراد الفيديو المولّد…",0);const r=await fetch(src);if(!r.ok)throw new Error("تعذر تنزيل الفيديو من المصدر.");const blob=await r.blob();const f=new File([blob],"hekaya-generated-"+(clips.length+1)+".mp4",{type:"video/mp4"});addFiles([f]);setStatus("أُضيف الفيديو المولّد إلى قائمة المونتاج.",0);}
    catch(e){setStatus("المتصفح منع استيراد الرابط تلقائيًا. نزّل الفيديو من معاينة حكاية ثم أضفه من زر إضافة فيديوهات.",0);}
  });
  $("#editorMusic").addEventListener("change",e=>{music=e.target.files[0]||null;$("#editorMusicName").textContent=music?"الموسيقى: "+music.name:"من غير موسيقى مضافة";});
  preview.addEventListener("loadedmetadata",()=>{$("#editorPreviewEmpty").hidden=true;});
  preview.addEventListener("error",()=>{$("#editorPreviewEmpty").hidden=false;});
  async function loadEngine(){
    if(ffmpeg?.loaded)return ffmpeg;
    setStatus("جاري تحميل محرك المونتاج لأول مرة…",2);
    const {FFmpeg}=await import("https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js");
    const {toBlobURL}=await import("https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js");
    ffmpeg=new FFmpeg();
    ffmpeg.on("progress",({progress:p})=>setStatus("جاري تجهيز الفيديو النهائي…",Math.min(95,12+p*82)));
    ffmpeg.on("log",({message})=>{if(/error/i.test(message))console.warn("FFmpeg:",message);});
    const base="https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    await ffmpeg.load({coreURL:await toBlobURL(base+"/ffmpeg-core.js","text/javascript"),wasmURL:await toBlobURL(base+"/ffmpeg-core.wasm","application/wasm")});
    return ffmpeg;
  }
  async function safeDelete(engine,name){try{await engine.deleteFile(name);}catch{}}
  exportBtn.addEventListener("click",async()=>{
    if(busy||!clips.length)return;
    busy=true;exportBtn.disabled=true;$("#editorDownload").hidden=true;
    try{
      const engine=await loadEngine(),height=Number($("#editorQuality").value),width=Math.round(height*9/16);
      for(const name of ["list.txt","final.mp4","music.mp3"])await safeDelete(engine,name);
      const normalized=[];
      for(let i=0;i<clips.length;i++){
        const c=clips[i],input="input_"+i+".mp4",output="clip_"+i+".mp4";
        setStatus("تجهيز المشهد "+(i+1)+" من "+clips.length+"…",Math.min(10,2+i/clips.length*8));
        await engine.writeFile(input,new Uint8Array(await c.file.arrayBuffer()));
        await engine.exec(["-i",input,"-vf","scale="+width+":"+height+":force_original_aspect_ratio=decrease,pad="+width+":"+height+":(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p","-an","-c:v","libx264","-preset","ultrafast","-crf","24","-movflags","+faststart",output]);
        normalized.push(output);await safeDelete(engine,input);
      }
      await engine.writeFile("list.txt",new TextEncoder().encode(normalized.map(n=>"file '"+n+"'").join("\n")));
      await engine.exec(["-f","concat","-safe","0","-i","list.txt","-c","copy","joined.mp4"]);
      if(music){
        await engine.writeFile("music.mp3",new Uint8Array(await music.arrayBuffer()));
        const volume=(Number($("#editorMusicVolume").value)/100).toFixed(2);
        await engine.exec(["-i","joined.mp4","-stream_loop","-1","-i","music.mp3","-filter:a","volume="+volume,"-map","0:v:0","-map","1:a:0","-c:v","copy","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart","final.mp4"]);
      }else await engine.exec(["-i","joined.mp4","-c","copy","-movflags","+faststart","final.mp4"]);
      const data=await engine.readFile("final.mp4"),blob=new Blob([data.buffer],{type:"video/mp4"});
      if(outputUrl)URL.revokeObjectURL(outputUrl);outputUrl=URL.createObjectURL(blob);
      const link=$("#editorDownload");link.href=outputUrl;link.hidden=false;
      preview.src=outputUrl;preview.load();$("#editorPreviewEmpty").hidden=true;
      setStatus("اكتمل الدمج! الفيديو النهائي جاهز للتنزيل.",100);
      if(typeof toast==="function")toast("الفيديو النهائي جاهز 🎬");
    }catch(error){console.error(error);setStatus("حصلت مشكلة أثناء الدمج: "+(error.message||"خطأ غير معروف"),0);}
    finally{busy=false;exportBtn.disabled=!clips.length;}
  });
  update();
})();