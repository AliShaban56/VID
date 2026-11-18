(() => {
  const input = document.querySelector("#agnesApiKey");
  const state = document.querySelector("#agnesKeyState");
  const status = document.querySelector("#agnesKeyStatus");
  const save = document.querySelector("#saveAgnesKey");
  const remove = document.querySelector("#removeAgnesKey");
  if (!input || !state || !status || !save || !remove) {
    console.warn("Agnes key settings UI elements not found");
    return;
  }
  const setStatus = (message, kind = "") => {
    status.textContent = message;
    status.dataset.status = kind;
  };
  async function request(method, payload) {
    const res = await fetch("/api/settings/agnes-key", {
      method, headers: payload ? {"content-type":"application/json"} : {},
      body: payload ? JSON.stringify(payload) : undefined,
      credentials: "same-origin"
    });
    const raw = await res.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch {}
    if (!res.ok) throw new Error(data.error || ("فشل الطلب (" + res.status + ")."));
    return data;
  }
  async function refresh() {
    setStatus("جارٍ التحقق من حالة المفتاح…");
    try {
      const data = await request("GET");
      state.textContent = data.configured ? "مضاف " + data.masked : "غير مضاف";
      remove.hidden = !data.configured;
      setStatus(data.configured ? "يوجد مفتاح محفوظ بالخادم. يمكنك استبداله أو حذفه." : "لم يتم إضافة مفتاح Agnes AI.");
    } catch (e) {
      setStatus("تعذر تحميل الحالة: " + e.message, "error");
    }
  }
  save.onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const key = input.value.trim();
    if (!key) { setStatus("الصق مفتاح Agnes AI الأول.", "error"); input.focus(); return; }
    save.disabled = true;
    setStatus("جاري حفظ المفتاح…");
    try {
      const data = await request("POST", {action:"save", apiKey:key});
      input.value = "";
      state.textContent = "مضاف " + data.masked;
      remove.hidden = false;
      setStatus("تم حفظ المفتاح في قاعدة البيانات.", "success");
      if (typeof toast === "function") toast("تم حفظ مفتاح Agnes AI");
    } catch (e) { setStatus("فشل الحفظ: " + e.message, "error"); }
    finally { save.disabled = false; }
  };
  remove.onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!confirm("حذف مفتاح Agnes AI المحفوظ؟")) return;
    remove.disabled = true;
    try {
      await request("POST", {action:"remove"});
      state.textContent = "غير مضاف";
      remove.hidden = true;
      setStatus("تم حذف المفتاح من قاعدة البيانات.", "success");
    } catch(e) { setStatus("فشل الحذف: " + e.message, "error"); }
    finally { remove.disabled = false; }
  };
  refresh();
})();