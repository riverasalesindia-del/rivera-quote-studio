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

// Scan the synced Dropbox tender folders and send the file list to the app (it classifies and adds new documents).
const SCAN_DIRS = ["RIVERA Team Folder/SALES/RCM", "RIVERA Team Folder/FINANCE/COMPANY DOCUMENTS", "RIVERA Team Folder/OPERATIONS", "RIVERA Team Folder/SALES/Rivera Quote Studio", "RIVERA Team Folder/SALES/COMPANY CREDENTIALS", "RIVERA Team Folder/QUALITY", "RIVERA Team Folder/PURCHASE/10.SUPPLIER REGISTRATION", "RIVERA Team Folder/PURCHASE/SWARNAGIRI COPPER CERTIFICATE"];
function walk(dir, base, out, depth) {
  if (depth > 10 || out.length > 80000) return;
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (e.name.startsWith(".") || /^RCR\b|^RCR[ _-]|^TRANSFER$|^2025-01-30_OLD DATA$/i.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out, depth + 1);
    else if (/\.(pdf|docx?|xlsx?)$/i.test(e.name)) { try { const st = fs.statSync(full); out.push({ path: "/" + path.relative(base, full).split(path.sep).join("/"), size: st.size, date: st.mtime.toISOString().slice(0, 10) }); } catch (er) {} }
  }
}
function scanDocs() {
  if (!win) return;
  for (const root of dropboxRoots()) {
    const files = [];
    for (const d of SCAN_DIRS) { const full = path.join(root, d); if (fs.existsSync(full)) walk(full, root, files, 0); }
    if (files.length) { win.webContents.executeJavaScript(`window.riveraDocScan && window.riveraDocScan(${JSON.stringify(files)}, ${JSON.stringify(path.basename(root))})`).catch(() => {}); return; }
  }
}

// GeM bids: GeM blocks requests from outside India, so the Windows app on the office PC does the GeM search and hands the rows to the page.
const GEM = { sess: null, at: 0 };
const GEM_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function gemSession(force) {
  if (!force && GEM.sess && Date.now() - GEM.at < 15 * 60000) return GEM.sess;
  const r = await fetch("https://bidplus.gem.gov.in/all-bids", { headers: { "User-Agent": GEM_UA } });
  const html = await r.text(), sc = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [r.headers.get("set-cookie") || ""];
  const cookies = sc.map(c => String(c).split(";")[0]).filter(Boolean).join("; ");
  const pick = id => (html.match(new RegExp('id=["\']' + id + '["\'][^>]*value=["\']([^"\']+)', "i")) || html.match(new RegExp('value=["\']([^"\']+)["\'][^>]*id=["\']' + id + '["\']', "i")) || [])[1];
  const csrf = pick("chash"), cname = pick("cname") || "csrf_bd_gem_nk";
  if (!csrf) throw new Error("GeM security token not found");
  GEM.sess = { cookies, csrf, cname }; GEM.at = Date.now(); return GEM.sess;
}
async function gemSearch(kw, page, status) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await gemSession(attempt > 0);
    const payload = { page, param: { searchBid: kw, searchType: "fullText" }, filter: { bidStatusType: status || "ongoing_bids", byType: "all", highBidValue: "", byEndDate: { from: "", to: "" }, sort: "Bid-End-Date-Latest" } };
    const body = new URLSearchParams({ payload: JSON.stringify(payload) }); body.set(s.cname, s.csrf);
    const r = await fetch("https://bidplus.gem.gov.in/all-bids-data", { method: "POST", body, headers: { "User-Agent": GEM_UA, "Cookie": s.cookies, "X-Requested-With": "XMLHttpRequest", "Referer": "https://bidplus.gem.gov.in/all-bids", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" } });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { }
    if (j && j.response && j.response.response) return j.response.response;
    GEM.sess = null;
  }
  throw new Error("GeM did not answer the search");
}
// Original tender documents for the bid pack: only PDF / Word files inside the scanned tender folders.
async function dropboxFile(rel) {
  const head = { "access-control-allow-origin": "*" };
  if (!/\.(pdf|docx?)$/i.test(rel)) return new Response("Not allowed", { status: 403, headers: head });
  for (const root of dropboxRoots()) {
    const full = path.normalize(path.join(root, rel)), r = path.relative(root, full).split(path.sep).join("/");
    if (r.startsWith("..") || !SCAN_DIRS.some(d => r.toLowerCase().startsWith(d.toLowerCase() + "/"))) continue;
    if (!fs.existsSync(full)) continue;
    const res = await net.fetch(pathToFileURL(full).toString());
    return new Response(res.body, { headers: { ...head, "content-type": /\.pdf$/i.test(full) ? "application/pdf" : "application/octet-stream" } });
  }
  return new Response("Not found", { status: 404, headers: head });
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
  win.webContents.on("did-finish-load", () => { sendFiles(filesFromArgs(process.argv)); setTimeout(sendPack, 2500); setTimeout(scanDocs, 9000); });
  setInterval(scanDocs, 30 * 60000);
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
      if (u.host === "dbx") return dropboxFile(p);
      if (u.host === "gem" && p === "/result") return (async () => {
        try { const id = String(u.searchParams.get("id") || "").replace(/[^0-9]/g, ""); if (!id) throw new Error("No bid id");
          const r = await fetch("https://bidplus.gem.gov.in/bidding/bid/getBidResultView/" + id, { headers: { "User-Agent": GEM_UA } });
          return new Response(await r.text(), { status: r.status, headers: { "content-type": "text/html; charset=utf-8" } }); }
        catch (e) { return new Response(String(e && e.message || e), { status: 502 }); }
      })();
      if (u.host === "gem") return (async () => {
        const head = { "content-type": "application/json", "access-control-allow-origin": "*" };
        try { const r = await gemSearch(String(u.searchParams.get("kw") || "").slice(0, 80), Math.max(1, Math.min(500, +u.searchParams.get("page") || 1)), u.searchParams.get("status") || "ongoing_bids"); return new Response(JSON.stringify({ ok: true, numFound: r.numFound || 0, docs: r.docs || [] }), { headers: head }); }
        catch (e) { return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }), { status: 502, headers: head }); }
      })();
      /* Tally Prime bridge: the page POSTs Tally XML to rivera://tally?host=…&port=…; only this PC or the office LAN is allowed */
      if (u.host === "tally") return (async () => {
        const head = { "content-type": "text/xml; charset=utf-8", "access-control-allow-origin": "*" };
        try {
          const host = String(u.searchParams.get("host") || "localhost").trim(), port = Math.max(1, Math.min(65535, +u.searchParams.get("port") || 9000));
          if (!/^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+)$/i.test(host)) throw new Error("Tally must be on this PC or the office network");
          const body = req.method === "POST" ? await req.text() : "";
          if (body.length > 8e6) throw new Error("Too much at once");
          const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
          const r = await fetch(`http://${host}:${port}`, { method: "POST", body, headers: { "content-type": "text/xml; charset=utf-8" }, signal: ctl.signal }).finally(() => clearTimeout(t));
          return new Response(await r.text(), { status: r.status, headers: head });
        } catch (e) { return new Response(`<ERROR>${String(e && e.message || e).replace(/[<&]/g, "")}</ERROR>`, { status: 502, headers: head }); }
      })();
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
