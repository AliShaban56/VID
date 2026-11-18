(() => {
  const keyList = document.querySelector("#kieKeyList");
  if (!keyList) return;
  const keyStatus = document.querySelector("#kieKeyStatus");
  const keyCount = document.querySelector("#kieKeyCount");
  const addButton = document.querySelector("#addKieKey");
  const imageButton = document.querySelector("#generateImage");
  const videoButton = document.querySelector("#generateVideo");
  const agnesVideoButton = document.querySelector("#generateAgnesVideo");
  const mediaStatus = document.querySelector("#kieMediaStatus");
  const preview = document.querySelector("#kieMediaPreview");
  const imageEl = document.querySelector("#kieGeneratedImage");
  const videoEl = document.querySelector("#kieGeneratedVideo");
  let generatedImageUrl = "";
  let generatedVideoUrl = "";
  const metricoolSend = document.createElement("button");
  metricoolSend.type = "button"; metricoolSend.className = "mini-btn green"; metricoolSend.id = "sendMetricool";
  metricoolSend.textContent = "إرسال الفيديو إلى Metricool"; metricoolSend.hidden = true; metricoolSend.disabled = true;
  mediaStatus.after(metricoolSend);
  metricoolSend.addEventListener("click", async () => {
    if (!generatedVideoUrl) { toast("ولّد الفيديو الأول"); return; }
    const token = prompt("Metricool API Token — Account Settings > API:");
    if (!token) return;
    const userId = prompt("Metricool userId (من رابط حساب Metricool):");
    if (!userId) return;
    const schedule = prompt("موعد النشر بتوقيت القاهرة (YYYY-MM-DDTHH:mm)، يجب أن يكون في المستقبل:");
    if (!schedule) return;
    const captionText = document.querySelector(".generated-meta")?.textContent?.replace(/^وصف النشر:\\s*/, "").trim() || "";
    const caption = captionText || document.querySelector("#story")?.textContent?.trim().slice(0, 1800) || "حكاية جديدة ✨";
    metricoolSend.disabled = true; metricoolSend.textContent = "جاري الإرسال إلى Metricool…";
    try {
      const result = await api("/api/metricool/schedule", { method: "POST", body: JSON.stringify({ token, userId, videoUrl: generatedVideoUrl, caption, schedule }) });
      mediaStatus.textContent = result.message || "تم إرسال الفيديو إلى Metricool.";
      metricoolSend.textContent = "اترسل إلى Metricool ✓";
      toast("تمت جدولة الفيديو في Metricool");
    } catch (error) {
      mediaStatus.textContent = "Metricool: " + error.message;
      metricoolSend.textContent = "إعادة الإرسال إلى Metricool";
      metricoolSend.disabled = false;
    }
  });
    const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);

  async function api(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(path, {
        ...options,
        signal: controller.signal,
        headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
      });
    } catch (error) {
      if (error.name === "AbortError") throw new Error("الحفظ اتأخر أكثر من 20 ثانية؛ تأكد من اتصال قاعدة البيانات وحاول مرة أخرى.");
      throw new Error("تعذر الاتصال بالخادم. راجع الإنترنت وحاول مرة أخرى.");
    } finally {
      clearTimeout(timeout);
    }
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || "حصل خطأ في الاتصال بالخادم.");
    return data;
  }

  async function refreshKeys() {
    keyStatus.textContent = "جاري تحميل قائمة المفاتيح…";
    try {
      const { keys = [] } = await api("/api/settings/kie-keys");
      keyCount.textContent = `${keys.length} مفاتيح`;
      keyStatus.textContent = keys.length ? "المفاتيح المحفوظة تظهر بالأسفل ويمكن حذف أي مفتاح." : "لا توجد مفاتيح محفوظة حتى الآن. أضف مفتاحك الأول.";
      keyList.innerHTML = keys.length ? keys.map((key) => {
        const state = key.status === "invalid" ? "غير مقبول" : key.status === "cooldown" ? `مهلة ${key.retryIn}ث` : "جاهز";
        const stateClass = key.status === "invalid" ? "invalid" : key.status === "cooldown" ? "cooldown" : "";
        return `<div class="kie-key-row"><strong>${escapeHtml(key.label)}</strong><code>${escapeHtml(key.masked)}</code><span class="key-status ${stateClass}">${state}</span><button class="kie-remove" type="button" data-remove-kie="${escapeHtml(key.id)}">إزالة</button></div>`;
      }).join("") : '<div class="empty" style="display:block">قائمة المفاتيح المحفوظة فاضية.</div>';
    } catch (error) {
      keyStatus.textContent = error.message;
      keyList.innerHTML = '<div class="empty" style="display:block">تعذر تحميل المفاتيح. جرّب تحديث القائمة.</div>';
    }
  }

  addButton.addEventListener("click", async () => {
    const apiKey = document.querySelector("#kieApiKey").value.trim();
    const label = document.querySelector("#kieKeyLabel").value.trim();
    if (!apiKey) { keyStatus.textContent = "أدخل مفتاح Kie.ai أولًا."; return; }
    addButton.disabled = true;
    const originalText = addButton.textContent;
    addButton.textContent = "جاري الحفظ…";
    keyStatus.textContent = "جاري حفظ المفتاح بأمان…";
    try {
      const result = await api("/api/settings/kie-keys", { method: "POST", body: JSON.stringify({ action: "add", apiKey, label }) });
      document.querySelector("#kieApiKey").value = "";
      document.querySelector("#kieKeyLabel").value = "";
      keyStatus.textContent = "تم حفظ المفتاح بنجاح، وهذه قائمة المفاتيح المحفوظة.";
      toast("اتحفظ مفتاح Kie.ai بنجاح");
      if (result.keys) {
        keyCount.textContent = `${result.keys.length} مفاتيح`;
        await refreshKeys();
      } else await refreshKeys();
    } catch (error) {
      keyStatus.textContent = error.message;
    } finally {
      addButton.disabled = false;
      addButton.textContent = originalText;
    }
  });

  keyList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-remove-kie]");
    if (!button) return;
    button.disabled = true;
    try {
      await api("/api/settings/kie-keys", { method: "POST", body: JSON.stringify({ action: "remove", id: button.dataset.removeKie }) });
      toast("اتشال المفتاح من التطبيق");
      await refreshKeys();
    } catch (error) {
      keyStatus.textContent = error.message;
      button.disabled = false;
    }
  });

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function waitForTask(taskId, message, limit = 180) {
    for (let attempt = 0; attempt < limit; attempt++) {
      mediaStatus.textContent = `${message} · ${Math.min(99, Math.floor((attempt / limit) * 100))}٪`;
      try {
        const task = await api(`/api/kie/jobs?taskId=${encodeURIComponent(taskId)}`);
        if (task.state === "success") {
          if (!task.resultUrls?.length) throw new Error("اكتملت المهمة لكن Kie.ai لم يرجع رابط الناتج.");
          return task.resultUrls[0];
        }
        if (task.state === "fail") throw new Error(task.failMsg || "فشلت مهمة التوليد.");
      } catch (error) {
        if (!/حد الاستخدام|مهلة مؤقتة/.test(error.message)) throw error;
      }
      await delay(4000);
    }
    throw new Error("التوليد لسه شغال؛ أعد فتح حالة المهمة بعد قليل.");
  }

  imageButton.addEventListener("click", async () => {
    const story = document.querySelector("#story")?.textContent?.trim();
    if (!story) { toast("ولّد الحكاية الأول"); return; }
    imageButton.disabled = true;
    videoButton.disabled = true;
    mediaStatus.textContent = "بنرسل مشهد الصورة إلى Kie.ai…";
    preview.hidden = true;
    imageEl.hidden = true;
    videoEl.hidden = true;
    generatedImageUrl = "";
    try {
      const prompt = `أنشئ صورة سينمائية عمودية مناسبة لريلز 9:16 مستوحاة من هذه الحكاية. مشهد بصري واقعي، إضاءة درامية، تعبيرات طبيعية، من دون أي كتابة أو شعارات. الحكاية: ${story.slice(0, 3000)}`;
      const created = await api("/api/kie/images", { method: "POST", body: JSON.stringify({ prompt, aspectRatio: "9:16" }) });
      generatedImageUrl = await waitForTask(created.taskId, "جاري توليد الصورة");
      imageEl.src = generatedImageUrl;
      imageEl.hidden = false;
      if (agnesVideoButton && !agnesVideoButton.hidden) agnesVideoButton.disabled = false;
      preview.hidden = false;
      mediaStatus.textContent = "الصورة جاهزة — بنبدأ تحويلها لفيديو تلقائيًا…";
      // Automatic image-to-video pipeline: no second button click needed.
      const storyForVideo = document.querySelector("#story")?.textContent?.trim() || "";
      const dialogueForVideo = storyForVideo.replace(/\\s+/g, " ").slice(0, 180);
      const videoPrompt = `حوّل الصورة إلى فيديو عمودي 9:16 مدته 8 ثوانٍ. حافظ على ملامح الشخصيات والمشهد، بحركة كاميرا سينمائية هادئة. أضف تعليقًا صوتيًا عربيًا مصريًا طبيعيًا بهذه الجملة: ${dialogueForVideo}`;
      const videoTask = await api("/api/kie/videos", { method: "POST", body: JSON.stringify({ prompt: videoPrompt, imageUrl: generatedImageUrl }) });
      const autoVideoUrl = await waitForTask(videoTask.taskId, "جاري توليد الفيديو تلقائيًا", 180);
      generatedVideoUrl = autoVideoUrl;\n      videoEl.src = autoVideoUrl;\n      tiktokPublish.disabled = !generatedVideoUrl;\n      refreshTikTokStatus();
      videoEl.hidden = false;
      preview.hidden = false;
      videoEl.load();
      mediaStatus.textContent = "اكتمل التوليد التلقائي: الصورة والفيديو جاهزان للمعاينة.";
    } catch (error) {
      mediaStatus.textContent = error.message;
    } finally { imageButton.disabled = false; }
  });

  videoButton.addEventListener("click", async () => {
    if (!generatedImageUrl) { toast("ولّد الصورة الأول"); return; }
    videoButton.disabled = true;
    mediaStatus.textContent = "بنرسل الصورة إلى Grok Imagine Video…";
    try {
      const story = document.querySelector("#story")?.textContent?.trim() || "";
      const dialogue = story.replace(/\s+/g, " ").slice(0, 180);
      const prompt = `حوّل الصورة إلى فيديو عمودي 9:16 مدته 8 ثوانٍ. حافظ على ملامح الشخصيات والمشهد، بحركة كاميرا سينمائية هادئة. أضف تعليقًا صوتيًا عربيًا مصريًا طبيعيًا بهذه الجملة: ${dialogue}`;
      const created = await api("/api/kie/videos", { method: "POST", body: JSON.stringify({ prompt, imageUrl: generatedImageUrl }) });
      const videoUrl = await waitForTask(created.taskId, "جاري تجهيز الفيديو", 180);
      generatedVideoUrl = videoUrl;\n      videoEl.src = videoUrl;\n      tiktokPublish.disabled = !generatedVideoUrl;\n      refreshTikTokStatus();
      videoEl.hidden = false;
      preview.hidden = false;
      mediaStatus.textContent = "الفيديو جاهز للمعاينة.";
      videoEl.load();
    } catch (error) {
      mediaStatus.textContent = error.message;
      videoButton.disabled = false;
    }
  });

  if (agnesVideoButton) {
    async function checkAgnesKey() {
      try {
        const status = await api("/api/settings/agnes-key");
        agnesVideoButton.hidden = !status.configured;
        agnesVideoButton.disabled = !status.configured || !generatedImageUrl;
      } catch {
        agnesVideoButton.hidden = true;
      }
    }
    agnesVideoButton.addEventListener("click", async () => {
      if (!generatedImageUrl) { toast("ولّد الصورة الأول"); return; }
      agnesVideoButton.disabled = true;
      const original = agnesVideoButton.textContent;
      mediaStatus.textContent = "بنرسل الصورة لموديل Agnes Video 2.5 Flash…";
      try {
        const storyText = document.querySelector("#story")?.textContent?.trim() || "";
        const prompt = "Animate the provided first frame into a cinematic vertical 9:16 video, 8 seconds long. Preserve the people, identities, clothes, setting, and art direction from the image. Add subtle natural body motion, facial expression, environmental movement, and a smooth cinematic camera move. No captions, logos, or text. Story context: " + storyText.slice(0, 1200);
        const created = await api("/api/agnes/videos", { method: "POST", body: JSON.stringify({ prompt, imageUrl: generatedImageUrl }) });
        let finalUrl = "";
        for (let attempt = 0; attempt < 150; attempt++) {
          mediaStatus.textContent = "Agnes بتولّد الفيديو… محاولة " + (attempt + 1) + " من 150";
          const job = await api("/api/agnes/jobs?videoId=" + encodeURIComponent(created.videoId));
          const state = String(job.status || "").toLowerCase();
          if (["completed", "complete", "success", "succeeded", "finished"].includes(state)) {
            finalUrl = job.videoUrl;
            if (!finalUrl) throw new Error("المهمة اكتملت لكن Agnes لم ترجع رابط الفيديو.");
            break;
          }
          if (["failed", "fail", "error"].includes(state)) throw new Error(job.error || "Agnes فشلت في توليد الفيديو.");
          await delay(4000);
        }
        if (!finalUrl) throw new Error("التوليد طول أكثر من الوقت المتوقع. جرّب فحص المهمة لاحقًا.");
        generatedVideoUrl = finalUrl;\n        videoEl.src = finalUrl;\n        tiktokPublish.disabled = !generatedVideoUrl;\n        refreshTikTokStatus();
        videoEl.hidden = false;
        preview.hidden = false;
        videoEl.load();
        mediaStatus.textContent = "فيديو Agnes جاهز للعرض! (720p)";
      } catch (error) {
        mediaStatus.textContent = "Agnes: " + error.message;
      } finally {
        agnesVideoButton.disabled = false;
      }
    });
    checkAgnesKey();
  }
  refreshKeys();
})();

