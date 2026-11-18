(() => {
  async function start() {
    let state;
    try {
      const response = await fetch("/api/auth/status", { cache: "no-store" });
      state = await response.json();
    } catch { return; }
    if (!state.required || state.authorized) return;

    const overlay = document.createElement("div");
    overlay.dir = "rtl";
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:#f4f6f1;display:grid;place-items:center;padding:24px;font-family:inherit;color:#203127";
    const panel = document.createElement("section");
    panel.style.cssText = "width:min(100%,420px);background:#fff;border:1px solid #dce4dc;border-radius:20px;padding:30px;box-shadow:0 20px 70px #19251b1c";
    if (!state.configured) {
      panel.innerHTML = '<div style="font-size:30px">🔒</div><h1 style="font-size:22px">حكاية محمية</h1><p style="line-height:1.9;color:#657267">أضف APP_ACCESS_PASSWORD وAPP_SESSION_SECRET في إعدادات Vercel، ثم أعد النشر لتفعيل الدخول الآمن.</p>';
    } else {
      panel.innerHTML = '<div style="font-size:30px">ح</div><h1 style="font-size:22px">تسجيل الدخول</h1><p style="line-height:1.8;color:#657267">أدخل كلمة مرور التطبيق للمتابعة.</p><form><label for="hekaya-password" style="display:block;margin:18px 0 7px">كلمة المرور</label><input id="hekaya-password" type="password" autocomplete="current-password" required style="box-sizing:border-box;width:100%;padding:13px;border:1px solid #dce4dc;border-radius:10px;font:inherit"><button style="width:100%;margin-top:14px;padding:13px;background:#318456;color:white;border:0;border-radius:10px;font:inherit;cursor:pointer">دخول</button><p role="alert" style="color:#b34a41"></p></form>';
      panel.querySelector("form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = panel.querySelector("button");
        const message = panel.querySelector('[role="alert"]');
        button.disabled = true;
        try {
          const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: panel.querySelector("input").value }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "تعذر تسجيل الدخول.");
          location.reload();
        } catch (error) { message.textContent = error.message; button.disabled = false; }
      });
    }
    overlay.append(panel);
    document.body.append(overlay);
  }
  start();
})();

