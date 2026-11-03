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

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600,
    title: "Rivera Quote Studio", icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#EEF1F0", autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("rivera://")) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.on("did-finish-load", () => sendFiles(filesFromArgs(process.argv)));
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
