(() => {
  const byId = (id) => document.getElementById(id);
  const escHtml = (value) => String(value ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let pkg = null;

  window.login = async function () {
    const message = byId('accessMessage');
    try {
      const response = await fetch('/api/login', {
        method: 'POST', headers: {'content-type':'application/json'},
        body: JSON.stringify({password: byId('accessPassword')?.value || ''})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر تسجيل الدخول');
      document.body.classList.add('authenticated');
      byId('accessPassword').value = '';
      if (message) message.textContent = 'تم تسجيل الدخول بنجاح.';
    } catch (error) {
      if (message) message.textContent = error.message;
    }
  };

  async function checkAccess() {
    const message = byId('accessMessage');
    try {
      const response = await fetch('/api/auth-status');
      const data = await response.json();
      if (response.ok && data.authenticated) {
        document.body.classList.add('authenticated');
        if (message) message.textContent = 'أنت مسجل الدخول.';
      } else if (response.status === 503) {
        if (message) message.textContent = data.error || 'أضف APP_ACCESS_PASSWORD في إعدادات Vercel.';
      } else if (message) {
        message.textContent = 'أدخل كلمة مرور الاستوديو للمتابعة.';
      }
    } catch (error) {
      if (message) message.textContent = 'تعذر التحقق من الدخول: ' + error.message;
    }
  }
  window.createStory = async function () {
    const concept = (byId('story')?.value || '').trim();
    const status = byId('productionStatus');
    if (!concept) { status.textContent = 'اكتب فكرة القصة أولاً.'; return; }
    status.textContent = 'مدير الإنتاج يكتب القصة والسيناريو وأوامر المشاهد عبر API...';
    try {
      const response = await fetch('/api/create-story', {
        method: 'POST', headers: {'content-type':'application/json'},
        body: JSON.stringify({
          concept, genre: byId('genre')?.value || 'دراما مشوقة',
          durationSeconds: Number(byId('duration')?.value || 120),
          sceneCount: Number(byId('sceneCount')?.value || 10),
          visualStyle: byId('visualStyle')?.value || 'سينمائي واقعي',
          language: 'Arabic'
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر إنشاء القصة');
      pkg = data;
      byId('story').value = data.story;
      localStorage.setItem('hekaya_story', data.story);
      localStorage.setItem('hekaya_production_package', JSON.stringify(data));
      if (data.database?.projectId) localStorage.setItem('hekaya_project_id', data.database.projectId);
      byId('productionBrief').innerHTML =
        '<h3>' + escHtml(data.title) + '</h3><p>' + escHtml(data.logline) + '</p>' +
        '<p><b>دليل العالم البصري:</b> ' + escHtml(data.visualBible) + '</p>' +
        '<p><b>اتجاه الموسيقى:</b> ' + escHtml(data.soundtrackDirection) + '</p>' +
        '<p><b>الشخصيات:</b> ' + (data.characters || []).map(c => escHtml(c.name + ': ' + c.visualDescription)).join(' | ') + '</p>';
      renderScenes();
      status.textContent = 'اكتمل إعداد ' + data.scenes.length + ' مشاهد بواسطة ' + data.model + '. ' +
        (data.database?.saved ? 'تم الحفظ في قاعدة البيانات.' : (data.database?.warning || 'تم حفظ النتيجة محليًا في هذا المتصفح.'));
    } catch (error) {
      status.textContent = 'تعذر إنشاء القصة: ' + error.message;
    }
  };

  function renderScenes() {
    const root = byId('scenes');
    if (!root || !pkg) return;
    root.innerHTML = (pkg.scenes || []).map((scene, i) =>
      '<div class="panel"><b>مشهد ' + (i + 1) + ': ' + escHtml(scene.title) + '</b>' +
      '<p><span class="muted">المدة: ' + scene.durationSeconds + ' ثانية</span></p>' +
      '<p><b>السرد:</b> ' + escHtml(scene.narration || '—') + '</p>' +
      '<p><b>الحوار:</b> ' + escHtml(scene.dialogue || '—') + '</p>' +
      '<p><b>الكاميرا:</b> ' + escHtml(scene.camera || '—') + '</p>' +
      '<p><b>الصوت:</b> ' + escHtml(scene.soundDesign || '—') + '</p>' +
      '<p><b>أمر الصورة:</b> ' + escHtml(scene.imagePrompt || '—') + '</p>' +
      '<p><b>أمر الفيديو:</b> ' + escHtml(scene.videoPrompt || '—') + '</p>' +
      '<p><b>الاستمرارية:</b> ' + escHtml(scene.generationNotes || '—') + '</p>' +
      '<button onclick="useScenePrompt(' + i + ',\'image\')">استخدم أمر الصورة</button>' +
      '<button onclick="useScenePrompt(' + i + ',\'video\')">استخدم أمر الفيديو</button>' +
      '<div id="scene-image-' + i + '">' + (scene.imageUrl ? '<img class="preview" src="' + escHtml(scene.imageUrl) + '" alt="مشهد ' + (i + 1) + '">' : '') + '</div></div>'
    ).join('') || 'لا توجد مشاهد بعد.';
  }

  window.useScenePrompt = function (index, type) {
    const scene = pkg?.scenes?.[index];
    if (!scene) return;
    byId('prompt').value = type === 'video' ? scene.videoPrompt : scene.imagePrompt;
    byId('msg').textContent = 'تم تحميل تعليمات ' + (type === 'video' ? 'الفيديو' : 'الصورة') + ' للمشهد ' + (index + 1) + '.';
    byId('prompt').scrollIntoView({behavior:'smooth', block:'center'});
  };

  window.generate = async function () {
    const prompt = (byId('prompt').value || '').trim();
    const msg = byId('msg'), result = byId('result');
    if (!prompt) { msg.textContent = 'اكتب وصفًا أولاً.'; return; }
    msg.textContent = 'جارٍ التوليد عبر API الخادم...'; result.innerHTML = '';
    try {
      const response = await fetch('/api/generate-image', {
        method: 'POST', headers: {'content-type':'application/json'},
        body: JSON.stringify({prompt})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'فشل توليد الصورة');
      result.innerHTML = '<img class="preview" src="' + escHtml(data.imageUrl) + '" alt="Generated image">';
      msg.textContent = 'اكتمل توليد الصورة.';
    } catch (error) { msg.textContent = error.message; }
  };


  window.renderFinalVideo = async function () {
    if (!pkg?.scenes?.length) {
      const status = byId('renderStatus'); if (status) status.textContent = 'أنشئ القصة وخطة المشاهد أولاً.';
      return;
    }
    const status = byId('renderStatus'), output = byId('videoOutput');
    status.textContent = 'إرسال أوامر كل المشاهد إلى محرك الفيديو والصوت والموسيقى...';
    if (output) output.innerHTML = '';
    try {
      const response = await fetch('/api/render-final-video', {
        method: 'POST', headers: {'content-type':'application/json'},
        body: JSON.stringify({
          productionPackage: pkg,
          projectId: localStorage.getItem('hekaya_project_id'),
          aspectRatio: byId('videoAspectRatio')?.value || '16:9',
          videoModel: byId('videoModel')?.value || undefined
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر بدء إنتاج الفيديو');
      localStorage.setItem('hekaya_render_id', data.renderId);
      localStorage.setItem('hekaya_render_version', data.version);
      status.textContent = 'تم إرسال المشروع إلى Shotstack. حالة الرندر: ' + data.status + '. المدة المخططة: ' + data.estimatedDurationSeconds + ' ثانية. أتابع تجهيز ملف MP4...';
      pollFinalVideo(data.renderId);
    } catch (error) {
      status.textContent = 'تعذر بدء الفيديو النهائي: ' + error.message;
    }
  };

  async function pollFinalVideo(renderId) {
    const status = byId('renderStatus');
    try {
      const response = await fetch('/api/final-video-status?id=' + encodeURIComponent(renderId));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر قراءة حالة الفيديو');
      if (data.status === 'done' && data.videoUrl) {
        localStorage.setItem('hekaya_final_video_url', data.videoUrl);
        if (status) status.textContent = 'اكتمل إنتاج الفيلم النهائي. ملف MP4 جاهز للمشاهدة.';
        const output = byId('videoOutput');
        if (output) output.innerHTML = '<video class="preview" controls playsinline src="' + escHtml(data.videoUrl) + '"></video><p><a href="' + escHtml(data.videoUrl) + '" target="_blank" rel="noopener">فتح ملف MP4 النهائي</a></p>';
        return;
      }
      if (data.status === 'failed') {
        if (status) status.textContent = 'فشل الرندر: ' + (data.error || 'خطأ من مزود الفيديو');
        return;
      }
      if (status) status.textContent = 'إنتاج الفيلم جارٍ... الحالة الحالية: ' + data.status + '. سيتم فحص الحالة مرة أخرى تلقائيًا.';
      window.setTimeout(() => pollFinalVideo(renderId), 8000);
    } catch (error) {
      if (status) status.textContent = 'تعذر تحديث حالة الفيديو: ' + error.message + '. أعد المحاولة بعد قليل من زر استكمال متابعة الرندر.';
    }
  }
  window.resumeFinalVideo = function () {
    const id = localStorage.getItem('hekaya_render_id');
    if (id) pollFinalVideo(id);
    else if (byId('renderStatus')) byId('renderStatus').textContent = 'لا يوجد رندر سابق لاستكمال متابعته.';
  };

  window.generateAllImages = async function () {
    const status = byId('productionStatus');
    if (!pkg?.scenes?.length) { status.textContent = 'أنشئ القصة وخطة المشاهد أولاً.'; return; }
    for (let i = 0; i < pkg.scenes.length; i++) {
      const scene = pkg.scenes[i];
      status.textContent = 'توليد صورة المشهد ' + (i + 1) + ' من ' + pkg.scenes.length + '...';
      try {
        const response = await fetch('/api/generate-image', {
          method: 'POST', headers: {'content-type':'application/json'},
          body: JSON.stringify({prompt: scene.imagePrompt})
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'فشل توليد الصورة');
        scene.imageUrl = data.imageUrl;
        const target = byId('scene-image-' + i);
        if (target) target.innerHTML = '<img class="preview" src="' + escHtml(data.imageUrl) + '" alt="مشهد ' + (i + 1) + '">';
        const projectId = localStorage.getItem('hekaya_project_id');
        if (projectId && data.imageUrl && !data.imageUrl.startsWith('data:')) {
          await fetch('/api/scenes', {
            method: 'POST', headers: {'content-type':'application/json'},
            body: JSON.stringify({
              id: projectId + '-scene-' + i, projectId, position: i,
              text: [scene.narration, scene.dialogue].filter(Boolean).join('\n'),
              imagePrompt: scene.imagePrompt, videoPrompt: scene.videoPrompt,
              imageUrl: data.imageUrl, status: 'image-ready'
            })
          });
        }
      } catch (error) {
        scene.imageError = error.message;
        const target = byId('scene-image-' + i);
        if (target) target.textContent = 'فشل التوليد: ' + error.message;
      }
      localStorage.setItem('hekaya_production_package', JSON.stringify(pkg));
    }
    status.textContent = 'اكتملت محاولة توليد الصور لكل المشاهد. راجع نتيجة كل مشهد وأي خطأ ظاهر.';
  };

  try {
    localStorage.removeItem('hekaya_api_settings');
    const saved = JSON.parse(localStorage.getItem('hekaya_production_package') || 'null');
    if (saved?.scenes) {
      pkg = saved;
      if (byId('productionBrief')) byId('productionBrief').textContent = 'تم استرجاع مخطط إنتاج محفوظ من هذا المتصفح.';
      renderScenes();
    }
    if (localStorage.getItem('hekaya_render_id') && byId('renderStatus')) {
      byId('renderStatus').innerHTML = 'يوجد رندر محفوظ. <button onclick="resumeFinalVideo()">استكمال متابعة الفيديو</button>';
      if (localStorage.getItem('hekaya_final_video_url') && byId('videoOutput')) {
        const url = localStorage.getItem('hekaya_final_video_url');
        byId('videoOutput').innerHTML = '<video class="preview" controls playsinline src="' + escHtml(url) + '"></video><p><a href="' + escHtml(url) + '" target="_blank" rel="noopener">فتح ملف MP4 النهائي</a></p>';
      }
    }
  } catch {}
  checkAccess();
})();