(() => {
  const $ = (s) => document.querySelector(s);
  const generate = $("#generate");
  if (!generate) return;
  let current = null;
  const selected = () => [...document.querySelectorAll(".platform.selected")].map((b) => b.dataset.platform);
  const status = document.createElement("div");
  status.id = "workflowStatus";
  status.className = "saved-note";
  status.setAttribute("aria-live", "polite");
  $("#result").append(status);

  async function request(path, payload) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "حصل خطأ أثناء تنفيذ الطلب.");
    return data;
  }

  function ensureButtons() {
    const actions = $("#result .result-actions");
    if (!actions) return;
    if (!$("#saveCloudDraft")) {
      const save = document.createElement("button");
      save.id = "saveCloudDraft";
      save.className = "mini-btn";
      save.type = "button";
      save.textContent = "حفظ في مكتبة حكاية";
      actions.append(save);
    }
    if (!$("#sendGithub")) {
      const send = document.createElement("button");
      send.id = "sendGithub";
      send.className = "mini-btn green";
      send.type = "button";
      send.textContent = "إرسال لجيت هاب";
      actions.append(send);
    }
  }

  // Capture before the legacy demo generator so it cannot replace the AI result.
  document.addEventListener("click", async (event) => {
    if (event.target.closest("#generate")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const topic = $("#topic").value.trim();
      const button = $("#generate");
      button.disabled = true;
      $("#loading").classList.add("show");
      $("#result").classList.remove("show");
      status.textContent = "";
      try {
        current = await request("/api/ai/generate-story", {
          topic,
          genre: $("#genre").value,
          dialect: $("#dialect").value,
          duration: $("#duration").value
        });
        $("#story").textContent = current.story;
        const head = $("#result .result-head");
        head.innerHTML = "<strong></strong><span>✓ قصة مولّدة بالذكاء الاصطناعي</span>";
        head.querySelector("strong").textContent = current.title;
        const hook = document.createElement("p");
        hook.className = "story generated-hook";
        hook.style.fontWeight = "700";
        hook.textContent = "الافتتاحية: " + current.hook;
        $("#story").before(hook);
        const extras = document.createElement("div");
        extras.className = "saved-note generated-meta";
        extras.textContent = "وصف النشر: " + current.caption + "  " + (current.hashtags || []).join(" ");
        $("#story").after(extras);
        ensureButtons();
        $("#result").classList.add("show");
        status.textContent = "القصة جاهزة للمراجعة. راجعها ثم احفظها أو أرسلها إلى GitHub.";
        if (typeof toast === "function") toast("اتولدت قصة جديدة بالذكاء الاصطناعي");
      } catch (error) {
        status.textContent = error.message;
        if (typeof toast === "function") toast(error.message);
      } finally {
        $("#loading").classList.remove("show");
        button.disabled = false;
      }
      return;
    }

    if (event.target.closest("#saveCloudDraft")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!current) return;
      const button = $("#saveCloudDraft");
      button.disabled = true;
      try {
        await request("/api/drafts", {
          title: current.title, topic: $("#topic").value.trim() || current.title,
          story: current.story, platforms: selected()
        });
        status.textContent = "اتحفظت القصة في مكتبة حكاية وقاعدة البيانات.";
        if (typeof toast === "function") toast("تم حفظ المسودة");
      } catch (error) {
        status.textContent = error.message;
      } finally { button.disabled = false; }
      return;
    }

    if (event.target.closest("#sendGithub")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!current) return;
      const button = $("#sendGithub");
      button.disabled = true;
      button.textContent = "جاري الإرسال…";
      try {
        const result = await request("/api/github/publish-story", {
          title: current.title, topic: $("#topic").value.trim(),
          story: current.story, caption: current.caption,
          hashtags: current.hashtags, visual_direction: current.visual_direction,
          platforms: selected()
        });
        status.textContent = "وصلت القصة إلى GitHub بنجاح: " + result.path;
        button.textContent = "تم الإرسال ✓";
        if (typeof toast === "function") toast("القصة وصلت GitHub");
      } catch (error) {
        status.textContent = error.message;
        button.textContent = "إرسال لجيت هاب";
        button.disabled = false;
      }
    }
  }, true);
})();
