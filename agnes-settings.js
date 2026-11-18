(() => {
  const input = document.querySelector("#agnesApiKey");
  const state = document.querySelector("#agnesKeyState");
  const status = document.querySelector("#agnesKeyStatus");
  const save = document.querySelector("#saveAgnesKey");
  const remove = document.querySelector("#removeAgnesKey");
  if (!input || !save || !status) return;
  async function request(method, payload) {
    const res = await fetch("/api/settings/agnes-key", {
      method, headers: payload ? {"content-type":"application/json"} : {},
      body: payload ? JSON.stringify(payload) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "تعذر تنفيذ الطلب.");
    return data;
  }
  async function refresh() {
    try {
      const data = await request("GET");
      state.textContent = data.configured ? "مضاف " + data.masked : "غير مضاف";
      remove.hidden = !data.configured;
      status.textContent = data.configured ? "يوجد مفتاح محفوظ على الخادم. يمكنك استبداله أو حذفه." : "لم يتم إضافة مفتاح Agnes AI.";
    } catch (e) { status.textContent = e.message; }
  }
  save.addEventListener("click", async () => {
    const key = input.value.trim();
    if (!key) { status.textContent = "الصق مفتاح Agnes AI الأول."; return; }
    save.disabled = true; status.textContent = "جاري حفظ المفتاح في قاعدة البيانات…";
    try {
      const data = await request("POST", {action:"save", apiKey:key});
      input.value = ""; state.textContent = "مضاف " + data.masked; remove.hidden = false;
      status.textContent = "تم حفظ المفتاح بشكل آمن على الخادم.";
      if (typeof toast === "function") toast("تم حفظ مفتاح Agnes AI");
    } catch (e) { status.textContent = e.message; }
    finally { save.disabled = false; }
  });
  remove.addEventListener("click", async () => {
    if (!confirm("حذف مفتاح Agnes AI المحفوظ؟")) return;
    remove.disabled = true;
    try { await request("POST", {action:"remove"}); state.textContent = "غير مضاف"; remove.hidden = true; status.textContent = "تم حذف المفتاح من قاعدة البيانات."; }
    catch(e) { status.textContent = e.message; }
    finally { remove.disabled = false; }
  });
  refresh();
})();
