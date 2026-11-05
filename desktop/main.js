// Rivera Quote Studio — Windows desktop app.
// Serves the bundled web app on a private secure scheme (rivera://) so storage,
// file pickers and the Synology folder connection work like in Chrome.
const { app, BrowserWindow, protocol, net, shell, session, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

protocol.registerSchemesAsPrivileged([
  { scheme: "rivera", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

const WEB = path.join(__dirname, "web");
let win = null;

function filesFromArgs(argv) {
  return argv.slice(1).filter(a => !a.startsWith("-") && /\.(pdf|xlsx|xlsm|xls|csv|docx|doc|txt|eml|png|jpe?g|webp|json)$/i.test(a) && fs.existsSync(a));
}
function sendFiles(paths) {
  if (!win || !paths.length) return;
  const list = paths.map(p => ({ name: path.basename(p), type: "", b64: fs.readFileSync(p).toString("base64") }));
  win.webContents.executeJavaScript(`window.riveraReceiveFiles && window.riveraReceiveFiles(${JSON.stringify(list)})`).catch(() => {});
}


// Look for rivera-data-pack.json in Dropbox (SALES/Rivera Quote Studio), Downloads, Documents, Desktop or next to the app,
// and hand the newest one to the app so the rate card loads by itself.
const os = require("os");
function dropboxRoots() {
  const out = [];
  for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA].filter(Boolean)) {
    try { const j = JSON.parse(fs.readFileSync(path.join(base, "Dropbox", "info.json"), "utf8")); for (const k of Object.keys(j)) if (j[k] && j[k].path) out.push(j[k].path); } catch (e) {}
  }
  const h = os.homedir();
  try { for (const n of fs.readdirSync(h)) if (/dropbox/i.test(n)) out.push(path.join(h, n)); } catch (e) {}
  return [...new Set(out)];
}
function packCandidates() {
  const h = os.homedir(), c = [];
  for (const r of dropboxRoots()) for (const s of ["RIVERA Team Folder/SALES/Rivera Quote Studio", "SALES/Rivera Quote Studio", "Rivera Quote Studio", ""]) c.push([path.join(r, s), "Dropbox"]);
  for (const [d, l] of [["Downloads", "Downloads"], ["Documents/Rivera Quote Studio", "Documents"], ["Documents", "Documents"], ["Desktop", "Desktop"]]) c.push([path.join(h, d), l]);
  c.push([path.dirname(process.execPath), "the app folder"]);
  if (process.env.PORTABLE_EXECUTABLE_DIR) c.push([process.env.PORTABLE_EXECUTABLE_DIR, "the app folder"]);
  return c;
}
function findPack() {
  let best = null;
  for (const [dir, label] of packCandidates()) {
    let names = []; try { names = fs.readdirSync(dir).filter(n => /^rivera-data-pack.*\.json$/i.test(n)); } catch (e) {}
    for (const n of names) {
      try {
        const f = path.join(dir, n); const st = fs.statSync(f);
        if (!st.isFile() || st.size > 5e6) continue;
        const j = JSON.parse(fs.readFileSync(f, "utf8")); if (j.kind !== "rivera-datapack") continue;
        if (!best || String(j.createdAt || "") > String(best.j.createdAt || "")) best = { j, label };
      } catch (e) {}
    }
  }
  return best;
}
function sendPack() {
  if (!win) return; const b = findPack(); if (!b) return;
  win.webContents.executeJavaScript(`window.riveraReceivePack && window.riveraReceivePack(${JSON.stringify(b.j)}, ${JSON.stringify(b.label)})`).catch(() => {});
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600,
    title: "Rivera Quote Studio", icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#EEF1F0", autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("rivera://")) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.on("did-finish-load", () => { sendFiles(filesFromArgs(process.argv)); setTimeout(sendPack, 2500); });
  win.on("focus", () => { if (Date.now() - (win._pk || 0) > 600000) { win._pk = Date.now(); sendPack(); } });
  win.loadURL("rivera://app/index.html#home");
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); sendFiles(filesFromArgs(argv)); }
  });
  app.whenReady().then(() => {
    protocol.handle("rivera", req => {
      const u = new URL(req.url);
      let p = decodeURIComponent(u.pathname || "/");
      if (p === "/" || p === "") p = "/index.html";
      const file = path.normalize(path.join(WEB, p));
      if (!file.startsWith(WEB)) return new Response("Not allowed", { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));
    session.defaultSession.setPermissionCheckHandler(() => true);
    Menu.setApplicationMenu(null);
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
