/**
 * Rivera Quote Studio — sign-in & team server (Google Apps Script web app).
 * Deploy: Deploy ▸ New deployment ▸ Web app ▸ Execute as: Me ▸ Who has access: Anyone.
 * Data lives in the spreadsheet bound to this script (sheets: Users, Log, Store).
 * Passwords are hashed in the browser (PBKDF2-SHA256, 150k rounds) and again here (salted SHA-256 x 500).
 */
var ADMIN = "crm@rivera.co.in";
var APP = "Rivera Quote Studio";
var TOKEN_DAYS = 7, MAX_FAIL = 5, LOCK_MIN = 15, CHUNK = 45000;

function props() { return PropertiesService.getScriptProperties(); }
function secret() { var p = props(), s = p.getProperty("SECRET"); if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty("SECRET", s); } return s; }
function ss() { var id = props().getProperty("SHEET"); if (id) return SpreadsheetApp.openById(id); var a = SpreadsheetApp.getActiveSpreadsheet(); if (a) return a; var n = SpreadsheetApp.create("Rivera Quote Studio — users & data"); props().setProperty("SHEET", n.getId()); return n; }
function sheet(name, head) { var s = ss(), sh = s.getSheetByName(name); if (!sh) { sh = s.insertSheet(name); if (head) sh.appendRow(head); } return sh; }
var UH = ["email", "name", "salt", "hash", "status", "role", "created", "lastLogin", "code", "codeExp", "fails", "lockUntil", "approvedBy"];
function users() { return sheet("Users", UH); }
function findUser(email) {
  var sh = users(), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).toLowerCase() === email) { var u = { row: i + 1 }; UH.forEach(function (k, j) { u[k] = v[i][j]; }); return u; }
  return null;
}
function saveUser(u) { var sh = users(), row = UH.map(function (k) { return u[k] === undefined ? "" : u[k]; }); if (u.row) sh.getRange(u.row, 1, 1, UH.length).setValues([row]); else { sh.appendRow(row); u.row = sh.getLastRow(); } }
function log(email, action, detail) { try { sheet("Log", ["time", "email", "action", "detail"]).appendRow([new Date(), email || "", action, detail || ""]); } catch (e) { } }
function b64(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ""); }
function hmac(s) { return b64(Utilities.computeHmacSha256Signature(s, secret())); }
function hashPw(pw, salt) { var h = salt + "|" + pw; for (var i = 0; i < 500; i++) h = b64(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + "|" + salt)); return h; }
function eq(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
function code6() { return String(Math.floor(100000 + Math.random() * 900000)); }
function cleanEmail(e) { e = String(e || "").trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 120) throw "Enter a valid email address"; return e; }
function token(u) { var exp = Date.now() + TOKEN_DAYS * 864e5, body = u.email + "|" + exp + "|" + u.role; return Utilities.base64EncodeWebSafe(body).replace(/=+$/, "") + "." + hmac(body); }
function auth(t, needAdmin) {
  var p = String(t || "").split("."); if (p.length !== 2) throw "AUTH";
  var body = Utilities.newBlob(Utilities.base64DecodeWebSafe(p[0] + "===".slice((p[0].length + 3) % 4))).getDataAsString();
  if (!eq(hmac(body), p[1])) throw "AUTH";
  var f = body.split("|"); if (Number(f[1]) < Date.now()) throw "AUTH";
  var u = findUser(f[0]); if (!u || u.status !== "approved") throw "AUTH";
  if (needAdmin && u.role !== "admin") throw "Admin only";
  return u;
}
function pub(u) { return { email: u.email, name: u.name, status: u.status, role: u.role, created: u.created ? new Date(u.created).toISOString() : "", lastLogin: u.lastLogin ? new Date(u.lastLogin).toISOString() : "", approvedBy: u.approvedBy || "" }; }
function appUrl() { return ScriptApp.getService().getUrl(); }
function mail(to, subject, html) { MailApp.sendEmail({ to: to, subject: subject, htmlBody: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#02315B">' + html + '<p style="color:#888;font-size:12px;margin-top:24px">' + APP + ' · Rivera Coil Manufacturing (I) Pvt Ltd</p></div>', name: APP }); }
function esc(s) { return String(s || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
function actLink(action, email) { var exp = Date.now() + 14 * 864e5, body = action + "|" + email + "|" + exp; return appUrl() + "?a=" + action + "&e=" + encodeURIComponent(email) + "&x=" + exp + "&s=" + hmac(body); }
function btn(href, label, color) { return '<a href="' + href + '" style="display:inline-block;padding:10px 18px;margin:4px 8px 4px 0;border-radius:6px;background:' + color + ';color:#fff;text-decoration:none;font-weight:bold">' + label + '</a>'; }
function notifyAdmin(u, why) {
  mail(ADMIN, "[" + APP + "] Access request: " + u.email, "<h2 style='margin:0 0 8px'>Access request</h2><p><b>" + esc(u.name) + "</b> &lt;" + esc(u.email) + "&gt; " + esc(why) + ".</p><p>Status: <b>" + u.status + "</b> · " + new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST</p><p>" + btn(actLink("approve", u.email), "Approve access", "#1a7f37") + btn(actLink("reject", u.email), "Reject", "#b42318") + "</p><p style='font-size:12px;color:#666'>You can also approve, revoke or make admin from the app: Admin ▸ Users.</p>");
}
function cfg(k, d) { var v = props().getProperty("CFG_" + k); return v === null ? d : v; }

/* ---------- blob store (chunked into the Store sheet) ---------- */
function putBlob(key, obj) { var sh = sheet("Store", ["key", "updated", "chunks..."]), s = JSON.stringify(obj), parts = []; for (var i = 0; i < s.length; i += CHUNK) parts.push(s.slice(i, i + CHUNK)); var v = sh.getDataRange().getValues(), row = 0; for (var r = 1; r < v.length; r++) if (v[r][0] === key) { row = r + 1; break; } if (!row) { sh.appendRow([key]); row = sh.getLastRow(); } sh.getRange(row, 1, 1, sh.getMaxColumns()).clearContent(); var vals = [key, new Date()].concat(parts); if (sh.getMaxColumns() < vals.length) sh.insertColumnsAfter(sh.getMaxColumns(), vals.length - sh.getMaxColumns()); sh.getRange(row, 1, 1, vals.length).setValues([vals]); }
function getBlob(key) { var sh = sheet("Store", ["key", "updated", "chunks..."]), v = sh.getDataRange().getValues(); for (var r = 1; r < v.length; r++) if (v[r][0] === key) { var s = v[r].slice(2).join(""); return s ? JSON.parse(s) : null; } return null; }
function mergeList(a, b) { var m = {}; (a || []).forEach(function (x) { if (x && x.id) m[x.id] = x; }); (b || []).forEach(function (x) { if (!x || !x.id) return; var o = m[x.id]; if (!o || Number(x.updatedAt || 0) >= Number(o.updatedAt || 0)) m[x.id] = x; }); return Object.keys(m).map(function (k) { return m[k]; }); }

/* ---------- API ---------- */
function api(d) {
  var a = d.action;
  if (a === "ping") return { ok: true, app: APP };
  if (a === "register") {
    var email = cleanEmail(d.email), name = String(d.name || "").trim().slice(0, 80), pw = String(d.pw || "");
    if (!name) throw "Enter your name"; if (pw.length < 40) throw "Password not accepted";
    var u = findUser(email);
    if (u && u.status !== "unverified") throw "This email is already registered — sign in, or use Forgot password";
    var cache = CacheService.getScriptCache(), k = "reg:" + email; if (cache.get(k)) throw "A code was just sent. Check your inbox (and spam), then try again in a minute.";
    cache.put(k, "1", 60);
    u = u || { email: email, created: new Date(), role: email === ADMIN ? "admin" : "sales", fails: 0 };
    u.name = name; u.salt = Utilities.getUuid(); u.hash = hashPw(pw, u.salt); u.status = "unverified"; u.code = code6(); u.codeExp = Date.now() + 30 * 6e4;
    saveUser(u); log(email, "register", name);
    mail(email, APP + " — your verification code " + u.code, "<p>Hello " + esc(name) + ",</p><p>Your verification code is</p><p style='font-size:28px;font-weight:bold;letter-spacing:4px'>" + u.code + "</p><p>It is valid for 30 minutes. If you did not ask for this, ignore this email.</p>");
    return { ok: true, next: "verify" };
  }
  if (a === "verify") {
    var email2 = cleanEmail(d.email), u2 = findUser(email2); if (!u2) throw "Register first";
    if (!u2.code || Number(u2.codeExp) < Date.now()) throw "Code expired — request a new one";
    if (!eq(String(d.code || "").trim(), u2.code)) { u2.fails = Number(u2.fails || 0) + 1; saveUser(u2); if (u2.fails >= MAX_FAIL) { u2.code = ""; saveUser(u2); throw "Too many wrong codes — request a new one"; } throw "Wrong code"; }
    u2.code = ""; u2.fails = 0;
    if (u2.status === "unverified") { u2.status = u2.email === ADMIN ? "approved" : "pending"; if (u2.email === ADMIN) { u2.role = "admin"; u2.approvedBy = "self (admin mailbox)"; } }
    saveUser(u2); log(email2, "verified", u2.status);
    if (u2.status === "pending") notifyAdmin(u2, "registered and is waiting for access");
    if (u2.status === "approved") { u2.lastLogin = new Date(); saveUser(u2); return { ok: true, status: "approved", token: token(u2), user: pub(u2) }; }
    return { ok: true, status: u2.status };
  }
  if (a === "login") {
    var email3 = cleanEmail(d.email), u3 = findUser(email3);
    if (!u3 || u3.status === "unverified") throw "Wrong email or password";
    if (Number(u3.lockUntil || 0) > Date.now()) throw "Too many attempts — try again after " + Math.ceil((u3.lockUntil - Date.now()) / 6e4) + " min";
    if (!eq(hashPw(String(d.pw || ""), u3.salt), u3.hash)) { u3.fails = Number(u3.fails || 0) + 1; if (u3.fails >= MAX_FAIL) { u3.lockUntil = Date.now() + LOCK_MIN * 6e4; u3.fails = 0; log(email3, "locked", ""); } saveUser(u3); log(email3, "login-fail", ""); throw "Wrong email or password"; }
    u3.fails = 0; u3.lockUntil = ""; saveUser(u3);
    if (u3.status === "pending") { var c3 = CacheService.getScriptCache(); if (!c3.get("nag:" + email3)) { c3.put("nag:" + email3, "1", 3600); notifyAdmin(u3, "tried to sign in and is waiting for access"); } log(email3, "login-pending", ""); return { ok: true, status: "pending" }; }
    if (u3.status !== "approved") { log(email3, "login-blocked", u3.status); return { ok: true, status: u3.status }; }
    u3.lastLogin = new Date(); saveUser(u3); log(email3, "login", d.device || "");
    if (cfg("loginMail", "1") === "1" && email3 !== ADMIN) mail(ADMIN, "[" + APP + "] Sign-in: " + email3, "<p><b>" + esc(u3.name) + "</b> &lt;" + esc(email3) + "&gt; signed in at " + new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST" + (d.device ? " from " + esc(d.device) : "") + ".</p><p>" + btn(actLink("revoke", email3), "Revoke access", "#b42318") + "</p>");
    return { ok: true, status: "approved", token: token(u3), user: pub(u3) };
  }
  if (a === "forgot") {
    var email4 = cleanEmail(d.email), u4 = findUser(email4), c4 = CacheService.getScriptCache();
    if (u4 && u4.status !== "unverified" && !c4.get("fg:" + email4)) { c4.put("fg:" + email4, "1", 60); u4.code = code6(); u4.codeExp = Date.now() + 30 * 6e4; saveUser(u4); mail(email4, APP + " — password reset code " + u4.code, "<p>Your password reset code is</p><p style='font-size:28px;font-weight:bold;letter-spacing:4px'>" + u4.code + "</p><p>Valid for 30 minutes.</p>"); log(email4, "forgot", ""); }
    return { ok: true };
  }
  if (a === "reset") {
    var email5 = cleanEmail(d.email), u5 = findUser(email5); if (!u5 || !u5.code || Number(u5.codeExp) < Date.now()) throw "Code expired — request a new one";
    if (!eq(String(d.code || "").trim(), u5.code)) { u5.fails = Number(u5.fails || 0) + 1; if (u5.fails >= MAX_FAIL) u5.code = ""; saveUser(u5); throw "Wrong code"; }
    if (String(d.pw || "").length < 40) throw "Password not accepted";
    u5.salt = Utilities.getUuid(); u5.hash = hashPw(d.pw, u5.salt); u5.code = ""; u5.fails = 0; u5.lockUntil = ""; saveUser(u5); log(email5, "password-reset", "");
    return { ok: true };
  }
  /* ---- signed-in actions ---- */
  var me = auth(d.token, false);
  if (a === "me") return { ok: true, user: pub(me), settings: { loginMail: cfg("loginMail", "1") === "1" } };
  if (a === "pack") { var p = getBlob("datapack"); return { ok: true, pack: p }; }
  if (a === "sync") {
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var cur = getBlob("register") || { quotes: [], data: {}, deleted: [] }, inc = d.snapshot || {};
      var del = {}; (cur.deleted || []).concat(inc.deleted || []).slice(-3000).forEach(function (k) { del[k] = 1; });
      cur.quotes = mergeList(cur.quotes, inc.quotes).filter(function (q) { return !del[q.id]; });
      cur.data = cur.data || {}; ["orders", "tenders", "vendors", "prices"].forEach(function (c) { cur.data[c] = mergeList(cur.data[c], (inc.data || {})[c]).filter(function (x) { return !del[c + ":" + x.id]; }); });
      cur.deleted = Object.keys(del); cur.savedAt = new Date().toISOString(); cur.by = me.email;
      if (inc.settings && Number(inc.settings.updatedAt || 0) > Number((cur.settings || {}).updatedAt || 0)) cur.settings = inc.settings;
      putBlob("register", cur); return { ok: true, register: cur };
    } finally { lock.releaseLock(); }
  }
  if (a === "password") { if (!eq(hashPw(String(d.old || ""), me.salt), me.hash)) throw "Current password is wrong"; if (String(d.pw || "").length < 40) throw "Password not accepted"; me.salt = Utilities.getUuid(); me.hash = hashPw(d.pw, me.salt); saveUser(me); log(me.email, "password-change", ""); return { ok: true }; }
  /* ---- admin ---- */
  auth(d.token, true);
  if (a === "users") { var v = users().getDataRange().getValues(), out = []; for (var i = 1; i < v.length; i++) { var x = {}; UH.forEach(function (k, j) { x[k] = v[i][j]; }); if (x.email) out.push(pub(x)); } return { ok: true, users: out }; }
  if (a === "setUser") {
    var tu = findUser(cleanEmail(d.email)); if (!tu) throw "No such user";
    if (tu.email === ADMIN && (d.status && d.status !== "approved" || d.role && d.role !== "admin")) throw "The main admin account can't be changed";
    if (d.status) { if (["approved", "revoked", "pending"].indexOf(d.status) < 0) throw "Bad status"; var was = tu.status; tu.status = d.status; if (d.status === "approved") tu.approvedBy = me.email; if (was !== "approved" && d.status === "approved") mail(tu.email, APP + " — access approved", "<p>Hello " + esc(tu.name) + ", your access to " + APP + " has been approved. You can sign in now.</p>"); }
    if (d.role) { if (["admin", "sales", "viewer"].indexOf(d.role) < 0) throw "Bad role"; tu.role = d.role; }
    saveUser(tu); log(me.email, "set-user", tu.email + " " + (d.status || "") + " " + (d.role || "")); return { ok: true, user: pub(tu) };
  }
  if (a === "deleteUser") { var du = findUser(cleanEmail(d.email)); if (!du || du.email === ADMIN) throw "Can't delete"; users().deleteRow(du.row); log(me.email, "delete-user", du.email); return { ok: true }; }
  if (a === "log") { var lv = sheet("Log", ["time", "email", "action", "detail"]).getDataRange().getValues().slice(1).slice(-300).reverse(); return { ok: true, log: lv.map(function (r) { return { time: new Date(r[0]).toISOString(), email: r[1], action: r[2], detail: r[3] }; }) }; }
  if (a === "putPack") { if (!d.pack || d.pack.kind !== "rivera-datapack") throw "Not a Rivera data pack"; putBlob("datapack", d.pack); log(me.email, "datapack-upload", ""); return { ok: true }; }
  if (a === "config") { if (d.loginMail !== undefined) props().setProperty("CFG_loginMail", d.loginMail ? "1" : "0"); return { ok: true }; }
  throw "Unknown action";
}
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doPost(e) {
  try { var d = JSON.parse(e.postData.contents || "{}"); return json(api(d)); }
  catch (err) { var m = typeof err === "string" ? err : (err && err.message) || "Server error"; if (m === "AUTH") return json({ ok: false, auth: false, error: "Session expired — sign in again" }); return json({ ok: false, error: m }); }
}
function page(title, msg, color) { return HtmlService.createHtmlOutput('<meta name="viewport" content="width=device-width,initial-scale=1"><div style="font-family:Arial,sans-serif;max-width:480px;margin:60px auto;padding:24px;border-top:6px solid ' + color + ';box-shadow:0 2px 12px rgba(0,0,0,.12);border-radius:8px"><h2 style="color:#02315B;margin-top:0">' + esc(title) + '</h2><p style="font-size:15px">' + msg + '</p><p style="color:#888;font-size:12px">' + APP + '</p></div>').setTitle(title); }
function doGet(e) {
  var p = e.parameter || {};
  if (!p.a) return page(APP, "Sign-in server is running.", "#02A9F0");
  try {
    var email = cleanEmail(p.e), body = p.a + "|" + email + "|" + p.x;
    if (!eq(hmac(body), p.s || "") || Number(p.x) < Date.now()) return page("Link expired", "This link is invalid or expired. Open the app ▸ Admin ▸ Users instead.", "#b42318");
    var u = findUser(email); if (!u) return page("Not found", "No such user.", "#b42318");
    if (u.email === ADMIN) return page("Not changed", "The main admin account can't be changed from email.", "#b42318");
    if (p.c !== "1") {
      var label = { approve: "Approve access", reject: "Reject request", revoke: "Revoke access" }[p.a] || "Confirm";
      var hid = ["a", "e", "x", "s"].map(function (k) { return '<input type="hidden" name="' + k + '" value="' + esc(p[k]) + '">'; }).join("") + '<input type="hidden" name="c" value="1">';
      return page(label + "?", "<b>" + esc(u.name) + "</b> (" + esc(email) + ") — currently <b>" + esc(u.status) + "</b>.</p><form method=\"get\" action=\"" + appUrl() + "\" target=\"_top\">" + hid + '<button style="padding:10px 18px;border:0;border-radius:6px;background:' + (p.a === "approve" ? "#1a7f37" : "#b42318") + ';color:#fff;font-weight:bold;font-size:15px;cursor:pointer">' + label + "</button></form><p>", "#02A9F0");
    }
    if (p.a === "approve") { u.status = "approved"; u.approvedBy = ADMIN + " (email)"; saveUser(u); log(ADMIN, "approve-email", email); mail(email, APP + " — access approved", "<p>Hello " + esc(u.name) + ", your access has been approved. You can sign in now.</p>"); return page("Access approved", "<b>" + esc(u.name) + "</b> (" + esc(email) + ") can now sign in.", "#1a7f37"); }
    if (p.a === "reject" || p.a === "revoke") { u.status = "revoked"; saveUser(u); log(ADMIN, p.a + "-email", email); return page(p.a === "reject" ? "Request rejected" : "Access revoked", esc(email) + " can no longer sign in.", "#b42318"); }
  } catch (err) { return page("Error", esc(String(err)), "#b42318"); }
  return page(APP, "Nothing to do.", "#02A9F0");
}
/** Run once from the editor to create the sheets and grant permissions. */
function setup() { secret(); users(); sheet("Log", ["time", "email", "action", "detail"]); sheet("Store", ["key", "updated", "chunks..."]); Logger.log("Ready. Sheet: " + ss().getUrl()); }
