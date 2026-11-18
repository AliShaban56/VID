#!/usr/bin/env node
/**
 * Hekaya Studio - Google Flow account window launcher.
 * Creates a separate browser profile for each account. Users sign in themselves.
 * This does not automate generation or bypass Google usage limits.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const root = join(homedir(), ".hekaya-flow");
const accountsFile = join(root, "accounts.json");
const profilesDir = join(root, "profiles");
const flowUrl = "https://labs.google/fx/tools/flow";

async function ensure() {
  await mkdir(profilesDir, { recursive: true });
}
async function accounts() {
  try { return JSON.parse(await readFile(accountsFile, "utf8")); }
  catch { return []; }
}
async function save(list) {
  await writeFile(accountsFile, JSON.stringify(list, null, 2), { mode: 0o600 });
}
function browserPath() {
  const candidates = process.platform === "win32"
    ? [(process.env.PROGRAMFILES ? process.env.PROGRAMFILES + "\\Google\\Chrome\\Application\\chrome.exe" : null), (process.env["PROGRAMFILES(X86)"] ? process.env["PROGRAMFILES(X86)"] + "\\Google\\Chrome\\Application\\chrome.exe" : null), (process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe" : null)]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
      : ["google-chrome", "chromium", "chromium-browser"];
  return candidates.find(Boolean);
}
function launch(account) {
  const executable = browserPath();
  if (!executable) throw new Error("Chrome/Chromium غير موجود. ثبّت Google Chrome ثم أعد المحاولة.");
  const profile = join(profilesDir, account.id);
  const args = ["--user-data-dir=" + profile, "--new-window", flowUrl];
  const child = spawn(executable, args, { detached: true, stdio: "ignore" });
  child.unref();
  console.log("فتح نافذة Flow للحساب: " + account.name + (account.email ? " (" + account.email + ")" : ""));
}
await ensure();
const [command, ...rest] = process.argv.slice(2);
const list = await accounts();

if (command === "add") {
  const name = rest[0]?.trim();
  const email = rest[1]?.trim() || "";
  if (!name) { console.log('استخدم: node flow-launcher.mjs add "اسم الحساب" "email (اختياري)"'); process.exit(1); }
  if (email && list.some(a => a.email.toLowerCase() === email.toLowerCase())) {
    console.log("البريد مسجل بالفعل."); process.exit(1);
  }
  const account = { id: randomUUID(), name, email, createdAt: new Date().toISOString() };
  list.push(account); await save(list);
  console.log("تمت إضافة الحساب. افتحه بالأمر: node flow-launcher.mjs open " + account.id);
} else if (command === "list") {
  if (!list.length) console.log("لا توجد حسابات. أضف حسابًا بالأمر add.");
  list.forEach((a, i) => console.log((i + 1) + ". " + a.name + (a.email ? " — " + a.email : "") + " [" + a.id + "]"));
} else if (command === "open") {
  const account = list.find(a => a.id === rest[0]);
  if (!account) { console.log("الحساب غير موجود. استخدم الأمر list."); process.exit(1); }
  launch(account);
} else if (command === "open-all") {
  if (!list.length) { console.log("أضف حسابات أولًا."); process.exit(1); }
  list.forEach(launch);
} else if (command === "remove") {
  const account = list.find(a => a.id === rest[0]);
  if (!account) { console.log("الحساب غير موجود."); process.exit(1); }
  await save(list.filter(a => a.id !== account.id));
  console.log("تم حذف الحساب من القائمة فقط؛ ملف جلسة المتصفح لم يُحذف.");
} else {
  console.log("أوامر Hekaya Flow launcher:");
  console.log('  add "اسم الحساب" "email اختياري"');
  console.log("  list");
  console.log("  open <id>");
  console.log("  open-all");
  console.log("  remove <id>");
}
