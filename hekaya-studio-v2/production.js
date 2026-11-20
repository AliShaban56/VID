(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let packageData = null, projectId = null, scenes = [], images = [], renderId = null;
  const storageKey = 'hekaya-v3-library';
  function localSave() {
    try {
      const all = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const id = projectId || ('local-' + Date.now());
      projectId = id;
      const item = {id,title:packageData?.title||'مشروع حكاية',story:packageData?.story||'',packageData,scenes,images,finalVideo:all.find(x=>x.id===id)?.finalVideo||'',updatedAt:new Date().toISOString()};
      const next=[item,...all.filter(x=>x.id!==id)];
      localStorage.setItem(storageKey,JSON.stringify(next.slice(0,30)));
    } catch {}
  }
  async function api(path,body,method='POST') {
    const r=await fetch(path,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error||'تعذر الاتصال بالخادم');
    return data;
  }
  function status(msg) { const s=$('productionStatus');s.classList.remove('hidden');s.textContent=msg; }
  function showTab(tab) {
    ['studio','library','providers'].forEach(t=>$(t).classList.toggle('hidden',t!==tab));
    ['studio','library','providers'].forEach(t=>$('tab'+t[0].toUpperCase()+t.slice(1)).classList.toggle('active',t===tab));
    if(tab==='library') refreshLibrary();
    if(tab==='providers'){ refreshProviderStatuses(); refreshMagicKeys(); }
  }
  window.showTab=showTab;
  window.toggleTheme=()=>{const d=document.documentElement.getAttribute('data-theme')==='dark';document.documentElement.setAttribute('data-theme',d?'light':'dark');localStorage.setItem('hekaya-theme',d?'light':'dark');};
  document.documentElement.setAttribute('data-theme',localStorage.getItem('hekaya-theme')||'light');
  function renderStory(){
    $('storyResult').classList.remove('hidden');
    $('storyResult').innerHTML='<h2>'+esc(packageData.title)+'</h2><p><b>'+esc(packageData.logline||'')+'</b></p><p>'+esc(packageData.story||'')+'</p><p class="muted">الشخصيات: '+esc((packageData.characters||[]).map(x=>x.name).join('، '))+'</p><p class="muted">الاستمرارية: '+esc(packageData.visualBible||'')+'</p>';
  }
  function renderScenes(){
    $('scenesResult').innerHTML=scenes.map((s,i)=>'<div class="scene"><div class="row" style="justify-content:space-between"><h3>المشهد '+(i+1)+' — '+esc(s.title)+'</h3><span class="asset-type">'+esc(s.durationSeconds)+' ثانية</span></div><p>'+esc(s.narration||'')+'</p><p class="muted">'+esc(s.dialogue||'')+'</p><p class="muted"><b>الصورة:</b> '+esc(s.imagePrompt||'')+'</p><p class="muted"><b>الحركة:</b> '+esc(s.videoPrompt||'')+'</p>'+(s.imageUrl?'<img src="'+esc(s.imageUrl)+'" alt="scene image">':'')+'<div class="row"><button class="secondary" onclick="generateSceneImage('+i+')">توليد صورة المشهد</button></div></div>').join('');
  }
  async function saveProjectAndScenes(){
    if(!packageData) return;
    if(!projectId) projectId=packageData.database?.projectId||'';
    if(!projectId) try{const p=await api('/api/projects',{title:packageData.title,story:packageData.story});projectId=p.id;}catch{projectId='local-'+Date.now();}
    try{await api('/api/projects',{id:projectId,title:packageData.title,story:packageData.story});}catch{}
    for(let i=0;i<scenes.length;i++)try{
      const s=scenes[i];await api('/api/scenes',{id:projectId+'-scene-'+i,projectId,position:i,text:[s.narration,s.dialogue].filter(Boolean).join('\n'),imagePrompt:s.imagePrompt,videoPrompt:s.videoPrompt,imageUrl:s.imageUrl||'',videoUrl:s.videoUrl||'',status:s.imageUrl?'image-ready':'script-ready'});
    }catch{}
    localSave();
  }
  async function makeStory(){
    const concept=$('concept').value.trim();if(!concept)throw new Error('اكتب فكرة القصة أولاً.');
    status('حكاية تكتب القصة وتجهز خطة الإنتاج...');
    packageData=await api('/api/create-story',{concept,language:'Arabic',genre:'دراما مشوقة',durationSeconds:Number($('duration').value),sceneCount:Number($('sceneCount').value),visualStyle:$('style').value,audience:'عام'});
    scenes=packageData.scenes||[];images=[];projectId=packageData.database?.projectId||null;
    renderStory();renderScenes();await saveProjectAndScenes();
    status('تمت كتابة القصة وتقسيم المشاهد. '+(packageData.database?.warning||''));
  }
  window.generateOnlyStory=async()=>{try{await makeStory();}catch(e){status(e.message);}};
  window.generateSceneImage=async(index)=>{
    const s=scenes[index];if(!s)return;
    status('إرسال صورة المشهد '+(index+1)+' إلى Magic Hour...');
    const out=await api('/api/generate-image',{
      prompt:s.imagePrompt,
      aspectRatio:$('ratio').value,
      projectId,
      sceneId:s.id||('scene-'+(index+1)),
      name:(packageData?.title||'حكاية')+' — المشهد '+(index+1)
    });
    let imageUrl=out.imageUrl||out.url||'';
    if(out.provider==='magichour'&&out.projectId){
      let ready=false;
      for(let attempt=0;attempt<80;attempt++){
        await new Promise(resolve=>setTimeout(resolve,3000));
        const state=await api('/api/final-video-status?provider=magichour&type=image&id='+encodeURIComponent(out.projectId),null,'GET');
        status('صورة المشهد '+(index+1)+': '+state.status);
        if(state.status==='complete'&&state.mediaUrl){imageUrl=state.mediaUrl;ready=true;break;}
        if(state.status==='error'||state.status==='canceled')throw new Error(state.error||'فشل توليد الصورة في Magic Hour.');
      }
      if(!ready)throw new Error('توليد الصورة ما زال جاريًا؛ أعد المحاولة بعد قليل.');
    }
    if(!imageUrl)throw new Error('لم يرجع مزود الصور رابط الصورة.');
    s.imageUrl=imageUrl;images[index]=imageUrl;renderScenes();await saveProjectAndScenes();
    status('تم توليد صورة المشهد '+(index+1)+' عبر Magic Hour');
    return imageUrl;
  };
  async function imageAll(){
    for(let i=0;i<scenes.length;i++){
      status('توليد الصور: '+(i+1)+' / '+scenes.length);
      await window.generateSceneImage(i);
    }
  }
  async function renderFinal(){
    status('إرسال المشاهد إلى Magic Hour لتوليد الفيديو والتعليق الصوتي والموسيقى...');
    const result=await api('/api/render-final-video',{projectId,aspectRatio:$('ratio').value,productionPackage:packageData});
    let renderId=result.renderId;
    if(result.provider==='magichour'){
      const jobs=result.projects||[];
      if(!jobs.length)throw new Error('لم يتم إنشاء أي مهمة وسائط في Magic Hour.');
      const completed=new Map();
      for(let attempt=0;attempt<120;attempt++){
        const states=await Promise.all(jobs.map(async job=>{
          try{return await api('/api/final-video-status?provider=magichour&type='+encodeURIComponent(job.type)+'&id='+encodeURIComponent(job.id),null,'GET');}
          catch(e){return {projectId:job.id,status:'retry',error:e.message};}
        }));
        let failed=null;
        states.forEach((state,index)=>{
          const job=jobs[index];
          if(state.status==='complete'&&state.mediaUrl)completed.set(job.id,{...job,url:state.mediaUrl});
          if(state.status==='error'||state.status==='canceled')failed=state.error||('فشلت مهمة '+job.id);
        });
        const finished=jobs.every(job=>completed.has(job.id));
        status('Magic Hour: اكتمل '+completed.size+' من '+jobs.length+' مهمة وسائط...');
        if(failed)throw new Error(failed);
        if(finished)break;
        await new Promise(resolve=>setTimeout(resolve,5000));
      }
      if(completed.size!==jobs.length)throw new Error('بعض عمليات Magic Hour لم تكتمل بعد؛ أعد فتح المشروع وتابع حالات المهام.');
      const ready=jobs.map(job=>completed.get(job.id));
      const videos=ready.filter(job=>job.type==='video').map(job=>({sceneIndex:job.sceneIndex,durationSeconds:job.durationSeconds,url:job.url}));
      const voices=ready.filter(job=>job.type==='audio'&&job.audioRole==='voice').map(job=>({sceneIndex:job.sceneIndex,start:job.start,url:job.url}));
      const music=ready.find(job=>job.type==='audio'&&job.audioRole==='music');
      status('اكتمل التوليد في Magic Hour؛ جارٍ تجميع المشاهد في ملف MP4...');
      const assembled=await api('/api/render-final-video',{
        action:'assemble',projectId,aspectRatio:$('ratio').value,
        assets:{videos,voices,music:music?{url:music.url}:null}
      });
      renderId=assembled.renderId;
    }
    if(!renderId)throw new Error('لم يرجع محرك التجميع معرّف الرندر النهائي.');
    $('finalResult').classList.remove('hidden');
    $('finalResult').innerHTML='<h2>الفيديو النهائي قيد الإنتاج</h2><p class="mono">Render ID: '+esc(renderId)+'</p><div id="renderStatus" class="progress">في انتظار اكتمال تركيب الفيديو...</div>';
    localSave();
    for(let i=0;i<80;i++){
      await new Promise(resolve=>setTimeout(resolve,5000));
      const state=await api('/api/final-video-status?id='+encodeURIComponent(renderId),null,'GET');
      $('renderStatus').textContent='الحالة: '+state.status;
      if(state.status==='done'&&state.videoUrl){
        $('finalResult').innerHTML='<h2>🎞️ الفيديو النهائي</h2><video controls playsinline src="'+esc(state.videoUrl)+'" style="width:100%;max-height:600px"></video><p><a href="'+esc(state.videoUrl)+'" target="_blank" rel="noopener">فتح/تنزيل الفيديو النهائي</a></p>';
        const all=JSON.parse(localStorage.getItem(storageKey)||'[]');const item=all.find(x=>x.id===projectId);if(item){item.finalVideo=state.videoUrl;localStorage.setItem(storageKey,JSON.stringify(all));}
        status('اكتمل رندر الفيديو النهائي.');await refreshLibrary();return;
      }
      if(state.status==='failed'){throw new Error(state.error||'فشل تركيب الفيديو النهائي');}
    }
    status('الفيديو ما زال قيد التركيب. يمكنك تحديث المكتبة لاحقًا. Render ID: '+renderId);
  }
  window.startProduction=async()=>{
    $('startBtn').disabled=true;
    try{await makeStory();await imageAll();await renderFinal();}
    catch(e){status('توقف الإنتاج: '+e.message);}
    finally{$('startBtn').disabled=false;}
  };
  window.refreshLibrary=async()=>{
    $('libraryStatus').textContent='جارٍ تحميل المكتبة...';
    const root=$('libraryAssets');
    let list=[];
    try{
      const data=await api('/api/library',null,'GET');
      list=(data.assets||[]);
      $('libraryStatus').textContent=list.length+' ملف/عنصر محفوظ في قاعدة البيانات.';
    }catch(e){
      list=JSON.parse(localStorage.getItem(storageKey)||'[]').flatMap(p=>[
        ...p.scenes.map((s,i)=>({title:p.title+' — المشهد '+(i+1),type:'image',url:s.imageUrl,project:p.title})).filter(x=>x.url),
        ...(p.finalVideo?[{title:p.title+' — الفيديو النهائي',type:'video',url:p.finalVideo,project:p.title}]:[])
      ]);
      $('libraryStatus').textContent='تعذر قراءة قاعدة البيانات ('+e.message+'). تعرض المكتبة الملفات الموجودة محليًا على هذا الجهاز.';
    }
    root.innerHTML=list.map(a=>'<article class="asset"><span class="asset-type">'+esc(a.type||'media')+'</span><h3>'+esc(a.title||'ملف')+'</h3>'+(a.type==='video'?'<video controls src="'+esc(a.url)+'"></video>':a.type==='audio'?'<audio controls src="'+esc(a.url)+'" style="width:100%"></audio>':a.type==='image'?'<img src="'+esc(a.url)+'" alt="">':'')+'<p class="muted">'+esc(a.project||'')+'</p>'+(a.excerpt?'<p>'+esc(a.excerpt)+'</p>':'')+(a.url?'<a href="'+esc(a.url)+'" target="_blank" rel="noopener">فتح الملف</a>':'')+'</article>').join('')||'<p class="muted">لا توجد ملفات محفوظة حتى الآن.</p>';
  };
  window.refreshProviderStatuses=async()=>{
    const root=$('providerStatusList');root.innerHTML='<div class="progress">جارٍ فحص...</div>';
    try{
      const d=await api('/api/provider-status',null,'GET');
      root.innerHTML=(d.providers||[]).map(p=>{
        const stateClass=p.state==='ok'?'connected':p.state==='missing'?'missing':'error';
        const stateLabel=p.state==='ok'?'متصل':p.state==='missing'?'غير مضاف':'غير متصل';
        if(p.id==='database')setDatabaseIndicator(stateClass,stateLabel);
        return '<article class="panel"><div class="row" style="justify-content:space-between"><b>'+esc(p.label)+'</b><span class="provider-connection"><i class="connection-lamp '+stateClass+'" aria-hidden="true"></i>'+stateLabel+'</span></div><p class="mono muted">'+esc(p.env||'')+'</p><p>'+esc(p.detail||'')+'</p><p class="muted">'+esc([p.model,p.videoModel,p.environment].filter(Boolean).join(' • '))+'</p></article>';
      }).join('');
      $('providerStatusUpdated').textContent='آخر فحص: '+new Date(d.checkedAt).toLocaleString('ar-EG');
    }catch(e){root.innerHTML='<div class="progress">'+esc(e.message)+'</div>';}
  };
  function setDatabaseIndicator(state,label){
    const root=$('databaseConnectionIndicator');
    if(!root)return;
    const safeState=['connected','missing','error','checking'].includes(state)?state:'missing';
    root.innerHTML='<i class="connection-lamp '+safeState+'" aria-hidden="true"></i><span>'+esc(label)+'</span>';
  }
  function setDatabaseSetupMessage(message){const root=$('databaseSetupStatus');if(!root)return;root.classList.remove('hidden');root.textContent=message;}
  window.connectDatabase=async()=>{
    const url=$('tursoDatabaseUrl')?.value.trim()||'';
    const token=$('tursoAuthToken')?.value.trim()||'';
    if(!url||!token){setDatabaseSetupMessage('أدخل Database URL وAuth Token أولًا.');return;}
    setDatabaseIndicator('checking','جارٍ فحص الاتصال');
    setDatabaseSetupMessage('جارٍ اختبار الاتصال وإنشاء جداول حكاية...');
    try{
      const result=await api('/api/db-init',{action:'connect',databaseUrl:url,authToken:token});
      $('tursoAuthToken').value='';
      setDatabaseSetupMessage(result.message||'تم ربط قاعدة البيانات بنجاح.');
      setDatabaseIndicator('connected','متصل');
      await refreshProviderStatuses();
      await refreshMagicKeys();
    }catch(error){setDatabaseIndicator('error','فشل الاتصال');setDatabaseSetupMessage(error.message||'تعذر ربط قاعدة البيانات.');}
  };
  window.initializeDatabase=async()=>{
    setDatabaseIndicator('checking','جارٍ فحص الاتصال');
    setDatabaseSetupMessage('جارٍ تهيئة الجداول...');
    try{
      const result=await api('/api/db-init',{action:'initialize'});
      setDatabaseSetupMessage(result.message||'تم تجهيز جداول قاعدة البيانات.');
      setDatabaseIndicator('connected','متصل');
      await refreshProviderStatuses();
    }catch(error){setDatabaseIndicator('error','فشل الاتصال');setDatabaseSetupMessage(error.message||'تعذر تهيئة الجداول.');}
  };
  window.disconnectDatabase=async()=>{
    if(!confirm('فصل اتصال قاعدة البيانات المحفوظ لهذا المتصفح؟'))return;
    setDatabaseIndicator('checking','جارٍ فصل الاتصال');
    setDatabaseSetupMessage('جارٍ فصل الاتصال...');
    try{
      const result=await api('/api/db-init',{action:'disconnect'});
      setDatabaseSetupMessage(result.environmentConfigured
        ?'تم فصل ربط المتصفح. ما زال اتصال الخادم في Vercel فعالًا.'
        :'تم فصل اتصال قاعدة البيانات من هذا المتصفح.');
      await refreshProviderStatuses();
      await refreshMagicKeys();
    }catch(error){setDatabaseSetupMessage(error.message||'تعذر فصل الاتصال.');}
  };

  window.refreshMagicKeys=async()=>{const root=$('magicKeysList');if(!root)return;try{const d=await api('/api/provider-status?resource=magichour-keys',null,'GET');root.innerHTML=(d.keys||[]).map(k=>'<div class="row panel"><span>'+esc(k.label)+' — '+esc(k.masked)+'</span><button class="secondary" onclick="removeMagicKey('+k.index+')">حذف</button></div>').join('')||'<p class="muted">لا توجد مفاتيح محفوظة.</p>';}catch(e){root.textContent=e.message;}};
  window.addMagicKey=async()=>{const input=$('magicKeyInput');const key=input.value.trim();if(!key)return alert('أدخل المفتاح أولاً');try{await api('/api/provider-status?resource=magichour-keys',{action:'add',key});input.value='';await refreshMagicKeys();alert('تم حفظ المفتاح مشفرًا');}catch(e){alert(e.message);}};
  window.removeMagicKey=async(index)=>{if(!confirm('حذف هذا المفتاح؟'))return;try{await api('/api/provider-status?resource=magichour-keys',{action:'remove',index});await refreshMagicKeys();}catch(e){alert(e.message);}};

  function unlockStudio(){
    $('loginGate')?.classList.add('hidden');
    $('appHeader')?.classList.remove('hidden');
    $('appMain')?.classList.remove('hidden');
    showTab('studio');
  }
  window.loginToStudio=async()=>{
    const message=$('loginMessage');
    const password=$('loginPassword')?.value||'';
    if(!password){message.textContent='اكتب كلمة المرور أولًا.';return;}
    message.textContent='جارٍ التحقق...';
    try{
      const response=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password}),cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok){message.textContent=data.error||'تعذر تسجيل الدخول.';return;}
      $('loginPassword').value='';
      unlockStudio();
    }catch(e){message.textContent='تعذر الاتصال بالخادم.';}
  };
  async function initAuth(){
    try{
      const response=await fetch('/api/auth-status',{cache:'no-store'});
      if(response.ok){unlockStudio();return;}
      if(response.status===503){
        $('loginMessage').textContent='المنصة مغلقة لحين ضبط APP_ACCESS_PASSWORD في إعدادات Vercel. لا تضف مفاتيح المزود قبل تفعيل الحماية.';
      }else{
        $('loginMessage').textContent='أدخل كلمة مرور المنصة للمتابعة.';
      }
    }catch(e){$('loginMessage').textContent='تعذر التحقق من جلسة الدخول. حدّث الصفحة.';}
  }
  initAuth();
})();
