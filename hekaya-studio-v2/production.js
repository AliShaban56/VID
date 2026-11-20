(() => {
  const byId = (id) => document.getElementById(id);
  const escHtml = (value) => String(value ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let pkg = null;

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
  } catch {}
})();