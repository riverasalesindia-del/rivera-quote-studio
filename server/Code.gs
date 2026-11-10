/**
 * Rivera Quote Studio — sign-in & team server (Google Apps Script web app).
 * Deploy: Deploy ▸ New deployment ▸ Web app ▸ Execute as: Me ▸ Who has access: Anyone.
 * Data lives in the spreadsheet bound to this script (sheets: Users, Log, Store).
 * Passwords are hashed in the browser (PBKDF2-SHA256, 150k rounds) and again here (salted SHA-256 x 500).
 */
var ADMIN = "crm@rivera.co.in";
var APP = "Rivera Quote Studio";
var TOKEN_DAYS = 400, MAX_FAIL = 5, LOCK_MIN = 15, CHUNK = 45000;

function props() { return PropertiesService.getScriptProperties(); }
function secret() { var p = props(), s = p.getProperty("SECRET"); if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty("SECRET", s); } return s; }
function ss() { var id = props().getProperty("SHEET"); if (id) return SpreadsheetApp.openById(id); var a = SpreadsheetApp.getActiveSpreadsheet(); if (a) return a; var n = SpreadsheetApp.create("Rivera Quote Studio — users & data"); props().setProperty("SHEET", n.getId()); return n; }
function sheet(name, head) { var s = ss(), sh = s.getSheetByName(name); if (!sh) { sh = s.insertSheet(name); if (head) sh.appendRow(head); } return sh; }
var UH = ["email", "name", "salt", "hash", "status", "role", "created", "lastLogin", "code", "codeExp", "fails", "lockUntil", "approvedBy", "contact"];
var SH = ["sid", "user", "device", "status", "created", "decidedAt", "decidedBy", "nonce", "lastSeen"];
function sessions() { return sheet("Sessions", SH); }
function findSession(sid) { var sh = sessions(), v = sh.getDataRange().getValues(); for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(sid)) { var s = { row: i + 1 }; SH.forEach(function (k, j) { s[k] = v[i][j]; }); return s; } return null; }
function saveSession(s) { var sh = sessions(), row = SH.map(function (k) { return s[k] === undefined ? "" : s[k]; }); if (s.row) sh.getRange(s.row, 1, 1, SH.length).setValues([row]); else { sh.appendRow(row); s.row = sh.getLastRow(); } }
function pubS(s) { return { sid: s.sid, user: s.user, device: s.device, status: s.status, created: s.created ? new Date(s.created).toISOString() : "", decidedAt: s.decidedAt ? new Date(s.decidedAt).toISOString() : "", decidedBy: s.decidedBy || "", lastSeen: s.lastSeen ? new Date(s.lastSeen).toISOString() : "" }; }
function cleanId(e) { e = String(e || "").trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9._@-]{2,79}$/.test(e)) throw "Enter a valid username"; return e; }
function adminReady() { var a = findUser(ADMIN); return !!(a && a.status === "approved"); }
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
function cleanEmail(e) { e = String(e || "").trim().toLowerCase(); if (e.indexOf("@") < 0) return cleanId(e); e = String(e || "").trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 120) throw "Enter a valid email address"; return e; }
function token(u, sid) { var exp = Date.now() + TOKEN_DAYS * 864e5, body = u.email + "|" + exp + "|" + u.role + "|" + sid; return Utilities.base64EncodeWebSafe(body).replace(/=+$/, "") + "." + hmac(body); }
function auth(t, needAdmin) {
  var p = String(t || "").split("."); if (p.length !== 2) throw "AUTH";
  var body = Utilities.newBlob(Utilities.base64DecodeWebSafe(p[0] + "===".slice((p[0].length + 3) % 4))).getDataAsString();
  if (!eq(hmac(body), p[1])) throw "AUTH";
  var f = body.split("|"); if (Number(f[1]) < Date.now()) throw "AUTH";
  var u = findUser(f[0]); if (!u || u.status !== "approved") throw "AUTH";
  var s = findSession(f[3]); if (!s || s.status !== "approved" || s.user !== u.email) throw "AUTH";
  u.sid = s.sid; if (!s.lastSeen || Date.now() - new Date(s.lastSeen).getTime() > 36e5) { s.lastSeen = new Date(); saveSession(s); }
  if (needAdmin && u.role !== "admin") throw "Admin only";
  return u;
}
function pub(u) { return { email: u.email, contact: u.contact || "", name: u.name, status: u.status, role: u.role, created: u.created ? new Date(u.created).toISOString() : "", lastLogin: u.lastLogin ? new Date(u.lastLogin).toISOString() : "", approvedBy: u.approvedBy || "" }; }
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
function newSession(u, device, status, by) { var s = { sid: Utilities.getUuid(), user: u.email, device: String(device || "").slice(0, 80), status: status, created: new Date(), nonce: Utilities.getUuid() + Utilities.getUuid(), decidedAt: status === "approved" ? new Date() : "", decidedBy: by || "" }; saveSession(s); return s; }
function sessLink(action, sid) { var exp = Date.now() + 3 * 864e5, body = action + "|" + sid + "|" + exp; return appUrl() + "?a=" + action + "&e=" + encodeURIComponent(sid) + "&x=" + exp + "&s=" + hmac(body); }
/* ---------- document store: one tab per file in a separate private spreadsheet ---------- */
var FCHUNK = 45000;
function seedOk(k) { var s = props().getProperty("SEEDKEY"), x = Number(props().getProperty("SEEDEXP") || 0); return !!(s && k && eq(String(k), s) && Date.now() < x); }
var BOOK_MAX = 35e6;   // bytes of base64 per spreadsheet before a new one is started
function filesBook(id) {
  if (id) return SpreadsheetApp.openById(id);
  var cur = props().getProperty("FILES_SS"), u0 = props().getProperty("FILES_USED"), used = u0 === null ? (cur ? BOOK_MAX : 0) : Number(u0);
  if (cur && used < BOOK_MAX) return SpreadsheetApp.openById(cur);
  var n = SpreadsheetApp.create("Rivera Quote Studio — private document store " + (cur ? Number(props().getProperty("FILES_N") || 1) + 1 : 1));
  props().setProperty("FILES_SS", n.getId()); props().setProperty("FILES_USED", "0"); props().setProperty("FILES_N", String(Number(props().getProperty("FILES_N") || (cur ? 1 : 0)) + 1));
  if (!props().getProperty("FILES_FIRST")) props().setProperty("FILES_FIRST", cur || n.getId());
  return n;
}
function bookOf(tab) { var s = String(tab || ""), i = s.indexOf("|"); return i > 0 ? { book: filesBook(s.slice(0, i)), tab: s.slice(i + 1) } : { book: filesBook(props().getProperty("FILES_FIRST") || props().getProperty("FILES_SS")), tab: s }; }
var FH = ["id", "name", "type", "size", "kind", "meta", "tab", "updated", "by"];
function fileIndex() { return sheet("FileIndex", FH); }
function fileRows() { var v = fileIndex().getDataRange().getValues(), out = []; for (var i = 1; i < v.length; i++) { var r = { row: i + 1 }; FH.forEach(function (k, j) { r[k] = v[i][j]; }); if (r.id) out.push(r); } return out; }
function fileList() { return fileRows().map(function (r) { var m = {}; try { m = JSON.parse(r.meta || "{}"); } catch (e) { } return { id: r.id, name: r.name, type: r.type, size: Number(r.size || 0), kind: r.kind, meta: m, updated: r.updated ? new Date(r.updated).toISOString() : "" }; }); }
function filePut(d, by, canOverwrite) {
  var id = String(d.id || "").slice(0, 120), b64 = String(d.b64 || ""); if (!id || !b64) throw "File id and content are required";
  if (b64.length > 40e6) throw "File too large";
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var rows = fileRows(), old = null; rows.forEach(function (r) { if (r.id === id) old = r; });
    if (old && !canOverwrite) return { ok: true, id: id, exists: true };
    var loc, sh;
    if (old) { loc = bookOf(old.tab); sh = loc.book.getSheetByName(loc.tab) || loc.book.insertSheet(loc.tab); }
    else { var book = filesBook(), tab = "f" + Utilities.getUuid().replace(/-/g, "").slice(0, 16); loc = { book: book, tab: tab }; sh = book.insertSheet(tab); }
    sh.clear(); var parts = []; for (var i = 0; i < b64.length; i += FCHUNK) parts.push([b64.slice(i, i + FCHUNK)]);
    if (sh.getMaxRows() < parts.length) sh.insertRowsAfter(sh.getMaxRows(), parts.length - sh.getMaxRows());
    sh.getRange(1, 1, parts.length, 1).setNumberFormat("@").setValues(parts);
    var tabRef = old ? old.tab : loc.book.getId() + "|" + loc.tab;
    var row = [id, String(d.name || id).slice(0, 200), String(d.type || "application/pdf").slice(0, 80), Math.round(b64.length * 3 / 4), String(d.kind || "doc").slice(0, 40), JSON.stringify(d.meta || {}).slice(0, 4000), tabRef, new Date(), by];
    if (old) fileIndex().getRange(old.row, 1, 1, FH.length).setValues([row]); else { fileIndex().appendRow(row); props().setProperty("FILES_USED", String(Number(props().getProperty("FILES_USED") || 0) + b64.length)); }
    var dflt = loc.book.getSheetByName("Sheet1"); if (dflt && loc.book.getSheets().length > 1) loc.book.deleteSheet(dflt);
    return { ok: true, id: id, size: row[3] };
  } finally { lock.releaseLock(); }
}
function fileGet(id) {
  var r = null; fileRows().forEach(function (x) { if (x.id === id) r = x; }); if (!r) throw "File not found";
  var loc = bookOf(r.tab), sh = loc.book.getSheetByName(loc.tab); if (!sh) throw "File not found";
  var n = sh.getLastRow(), v = n ? sh.getRange(1, 1, n, 1).getValues() : [];
  return { ok: true, id: id, name: r.name, type: r.type, b64: v.map(function (x) { return String(x[0]); }).join("") };
}
function fileDel(id) { fileRows().forEach(function (r) { if (r.id === id) { var loc = bookOf(r.tab), sh = loc.book.getSheetByName(loc.tab); if (sh) loc.book.deleteSheet(sh); fileIndex().deleteRow(r.row); } }); }

/* ================= Tender automation (Tender247-style) =================
 * scanTenderMail(): reads tender alert emails from GeM, CPPP / NIC portals, Coal India, PSU portals and
 *   tender aggregators (Tender247, TenderTiger, BidAssist …) in this script's Gmail, and pulls out
 *   bid number, portal, item, buyer, closing date, EMD, value and corrigenda.
 * hourlyWatch(): runs every hour — adds strong matches to the shared tender list (no one has to open the app),
 *   records corrigendum date changes, and emails an instant alert for each new strong match.
 * dailyDigest(): runs every morning 8:30 IST — one email with new matches, closings, RA, pre-bid, EMD/PBG.
 * installAutomation(): run once from the editor (or "Turn on" in the app) to create both timers.
 */
var KW_BASE = ["stator coil", "rotor coil", "roebel bar", "stator bar", "armature coil", "field coil", "pole coil", "rewinding", "rewind", "generator", "hv motor", "winding", "coil", "insulation", "mica tape"];
var TENDER_Q = '("GEM/20" OR from:gem.gov.in OR from:eprocure.gov.in OR from:nic.in OR from:coalindia.in OR from:coalindiatenders.nic.in OR from:tender247.com OR from:tendertiger.com OR from:bidassist.com OR from:tendersinfo.com OR from:tenderdetail.com OR subject:tender OR subject:corrigendum OR subject:"bid alert") newer_than:45d';
function kwList() { try { var r = getBlob("register"); var k = r && r.settings && r.settings.tenderKeywords; if (k && k.length) return k; } catch (e) { } return KW_BASE; }
function fitOf(text, kw) {
  var s = String(text || "").toLowerCase(), n = 0;
  kw.forEach(function (w) { if (w && s.indexOf(String(w).toLowerCase()) >= 0) n += String(w).indexOf(" ") >= 0 ? 2 : 1; });
  if (/ncl|mcl|ccl|secl|wcl|coal|ntpc|bhel|nhpc|tneb|tangedco|hindustan copper|power|thermal|hydro/.test(s)) n++;
  return Math.min(100, n * 25);
}
function isoDate(s) {
  s = String(s || "").trim(); if (!s) return "";
  var m = s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/); if (m) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  m = s.match(/(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[-, ]+(\d{4})/);
  if (m) { var mo = "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(m[2].toLowerCase()) / 3 + 1; if (mo > 0) return m[3] + "-" + ("0" + mo).slice(-2) + "-" + ("0" + m[1]).slice(-2); }
  return "";
}
function money(s, unit) { var v = Number(String(s || "").replace(/,/g, "")) || 0; unit = String(unit || "").toLowerCase(); if (/^cr/.test(unit)) v *= 1e7; else if (/^la|^lac/.test(unit)) v *= 1e5; return Math.round(v); }
function portalOf(id, from, txt) {
  if (/^GEM\//.test(id)) return "GeM"; var f = String(from || "").toLowerCase() + " " + String(txt || "").slice(0, 400).toLowerCase();
  if (/coalindia/.test(f)) return "Coal India e-proc"; if (/eprocure\.gov\.in|cppp/.test(f)) return "CPPP"; if (/ntpc/.test(f)) return "NTPC"; if (/bhel/.test(f)) return "BHEL";
  if (/tender247/.test(f)) return "Tender247"; if (/tendertiger/.test(f)) return "TenderTiger"; if (/bidassist/.test(f)) return "BidAssist"; if (/nic\.in/.test(f)) return "State / NIC e-proc";
  return "Email alert";
}
function scanTenderMail() {
  var kw = kwList(), out = [], seen = {}, th = GmailApp.search(TENDER_Q, 0, 120);
  var ID = /GEM\/\d{4}\/[BR]\/\d{5,}|\b20\d{2}_[A-Z][A-Z0-9]{1,14}_\d{3,8}_\d{1,2}\b|(?:Tender\s*(?:ID|No\.?|Number|Ref(?:erence)?)|T247\s*ID|NIT\s*No\.?|Enquiry\s*No\.?)\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\/_.\-]{4,40})/gi;
  th.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      var subj = m.getSubject() || "", body = m.getPlainBody() || "", txt = subj + "\n" + body, from = String(m.getFrom() || ""), mm, hits = [];
      var corr = /corrigend|addend|extension|extended|date (?:change|revis)|revised (?:date|schedule)/i.test(subj);
      ID.lastIndex = 0;
      while ((mm = ID.exec(txt))) { var id = (mm[1] || mm[0]).replace(/[.\-]+$/, ""); if (/^\d{4}$/.test(id) || id.length < 6 || !/\d{3}/.test(id)) continue; hits.push({ id: id, at: mm.index, end: mm.index + mm[0].length }); }
      hits.forEach(function (h, i) {
        var key = h.id + (corr ? "#c" : ""); if (seen[key]) return; seen[key] = 1;
        var prevEnd = i ? hits[i - 1].end : 0, next = i + 1 < hits.length ? hits[i + 1].at : txt.length;
        var back = txt.slice(Math.max(prevEnd, h.at - 160), h.at), pb = back.lastIndexOf("\n\n"); if (pb >= 0) back = back.slice(pb); else if (i) back = back.slice(-60);
        var fwd = txt.slice(h.end, Math.min(next, h.end + 900)); var blk = back + " " + fwd;
        var ctx = (back + " " + h.id + " " + fwd).replace(/\s+/g, " ");
        var close = (blk.match(/(?:bid end|end date|closing|due date|last date|submission (?:end|date)|bid submission)[^0-9A-Za-z]{0,40}(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{4}|\d{1,2}[- ][A-Za-z]{3,9}[-, ]+\d{4})/i) || [])[1] || (fwd.match(/\d{2}[-\/]\d{2}[-\/]\d{4}/) || [""])[0];
        var preBid = (blk.match(/pre[- ]?bid[^0-9]{0,40}(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{4}|\d{1,2}[- ][A-Za-z]{3,9}[-, ]+\d{4})/i) || [])[1] || "";
        var emd = blk.match(/EMD[^0-9₹\n]{0,25}(?:₹|Rs\.?|INR)?\s*([\d,]{3,}(?:\.\d+)?)\s*(lakh|lac|crore|cr)?/i);
        var val = blk.match(/(?:estimated (?:bid )?value|tender value|ECV|bid value|value of (?:the )?(?:tender|work))[^0-9₹\n]{0,25}(?:₹|Rs\.?|INR)?\s*([\d,]{3,}(?:\.\d+)?)\s*(lakh|lac|crore|cr)?/i);
        var org = ((blk.match(/(?:organi[sz]ation|department|buyer|ministry|company)\s*(?:name)?\s*[:\-]\s*([^\n|]{3,90})/i) || [])[1] || "").trim();
        var item = ((blk.match(/(?:item(?: category)?|title|work|description|tender brief|product)\s*(?:name)?\s*[:\-]\s*([^\n|]{4,200})/i) || [])[1] || fwd.replace(/\s+/g, " ").replace(/^[\s:.,-]*/, "").split(/bid end|end date|https?:|\bview\b/i)[0]).slice(0, 180).trim();
        var link = (fwd.match(/https?:\/\/[^\s"'<>]+/i) || [""])[0];
        out.push({ bid: h.id, portal: portalOf(h.id, from, txt), subject: subj.slice(0, 200), ctx: ctx.slice(0, 700), item: item, org: org.slice(0, 90), end: close, closing: isoDate(close), preBid: isoDate(preBid),
          emd: emd ? money(emd[1], emd[2]) : 0, value: val ? money(val[1], val[2]) : 0, corr: corr, link: link, date: m.getDate().toISOString(), from: from.slice(0, 80), fit: fitOf(item + " " + ctx.slice(0, 200) + " " + org, kw) });
      });
    });
  });
  return out;
}
function regUpdate(fn) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { var cur = getBlob("register") || { quotes: [], data: {}, deleted: [] }; cur.data = cur.data || {}; cur.data.tenders = cur.data.tenders || []; var ch = fn(cur); if (ch) { cur.savedAt = new Date().toISOString(); cur.by = "automation"; putBlob("register", cur); } return ch; }
  finally { lock.releaseLock(); }
}
function tid(bid) { return String(bid).replace(/[^A-Za-z0-9]+/g, "-"); }
function applyAlerts(alerts) {
  var today = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd"), added = [], changed = [];
  regUpdate(function (cur) {
    var del = {}; (cur.deleted || []).forEach(function (k) { del[k] = 1; });
    var byBid = {}; cur.data.tenders.forEach(function (t) { byBid[t.bid] = t; });
    alerts.forEach(function (a) {
      var t = byBid[a.bid];
      if (t) {
        if (a.closing && t.closing && a.closing !== t.closing && (a.corr || a.closing > t.closing) && !(t.history || []).some(function (h) { return h.to === a.closing; })) {
          (t.history = t.history || []).push({ at: new Date().toISOString(), what: "Closing date changed (corrigendum)", from: t.closing, to: a.closing, by: "automation" });
          t.closing = a.closing; t.updatedAt = Date.now(); changed.push({ bid: a.bid, from: t.history[t.history.length - 1].from, to: a.closing, org: t.org || a.org });
        }
        return;
      }
      if (a.fit >= 50 && (!a.closing || a.closing >= today) && !del["tenders:" + tid(a.bid)]) {
        var n = { id: tid(a.bid), bid: a.bid, portal: a.portal, org: a.org || "", status: "identified", items: a.item || a.subject, closing: a.closing || "", preBid: a.preBid || "", emdMode: a.emd ? "required" : "exempt_mse", emdAmount: a.emd || "", emdStatus: a.emd ? "to_pay" : "", emd: a.emd ? "Rs " + a.emd : "Exempted (MSE)", value: a.value || "", check: {}, fit: true, link: a.link, updatedAt: Date.now(),
          history: [{ at: new Date().toISOString(), what: "Added automatically from " + a.portal + " alert (" + a.fit + "% match)", by: "automation" }] };
        cur.data.tenders.push(n); byBid[a.bid] = n; added.push(a);
      }
    });
    return added.length || changed.length;
  });
  return { added: added, changed: changed };
}
function digestTo() {
  var to = cfg("digestTo", ""); if (to) return to;
  var a = findUser(ADMIN); return (a && /@/.test(a.contact) ? a.contact : ADMIN);
}
function rowHtml(cells) { return "<tr>" + cells.map(function (c) { return '<td style="padding:6px 8px;border-bottom:1px solid #e5e9ee;vertical-align:top">' + c + "</td>"; }).join("") + "</tr>"; }
function tableHtml(title, head, rows) {
  if (!rows.length) return "";
  return '<h3 style="color:#02315B;margin:18px 0 6px">' + esc(title) + ' <span style="color:#E25E00">(' + rows.length + ')</span></h3><table style="border-collapse:collapse;width:100%;font-size:13px"><tr>' +
    head.map(function (h) { return '<th style="text-align:left;padding:6px 8px;background:#02315B;color:#fff">' + esc(h) + "</th>"; }).join("") + "</tr>" + rows.join("") + "</table>";
}
function dmyS(iso) { iso = String(iso || ""); return iso.length >= 10 ? iso.slice(8, 10) + "-" + iso.slice(5, 7) + "-" + iso.slice(0, 4) : ""; }
function hourlyWatch() {
  var alerts = scanTenderMail(), res = applyAlerts(alerts), P = props();
  var sent = {}; try { sent = JSON.parse(P.getProperty("ALERTED") || "{}"); } catch (e) { }
  var hot = alerts.filter(function (a) { return a.fit >= 75 && !sent[a.bid] && (!a.closing || a.closing >= Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd")); });
  if (hot.length || res.changed.length) {
    var html = '<p>New tenders matching Rivera\'s products' + (res.changed.length ? " and date changes" : "") + ":</p>" +
      tableHtml("Strong matches", ["Match", "Bid / tender", "Portal", "Item", "Closing"], hot.map(function (a) { return rowHtml(["<b>" + a.fit + "%</b>", esc(a.bid), esc(a.portal), esc(a.item || a.subject), dmyS(a.closing)]); })) +
      tableHtml("Corrigendum — closing date changed", ["Bid / tender", "Buyer", "Was", "Now"], res.changed.map(function (c) { return rowHtml([esc(c.bid), esc(c.org), dmyS(c.from), "<b>" + dmyS(c.to) + "</b>"]); })) +
      '<p style="margin-top:16px">' + btn(appUrl().replace(/\/exec.*/, "/exec"), "Open " + APP, "#02315B") + "</p>";
    mail(digestTo(), APP + " — " + (hot.length ? hot.length + " new tender" + (hot.length > 1 ? "s" : "") + " for Rivera" : "tender date changed"), html);
    hot.forEach(function (a) { sent[a.bid] = Date.now(); });
    var keys = Object.keys(sent).sort(function (x, y) { return sent[y] - sent[x]; }).slice(0, 800), keep = {}; keys.forEach(function (k) { keep[k] = sent[k]; });
    P.setProperty("ALERTED", JSON.stringify(keep));
  }
  CacheService.getScriptCache().remove("tenderAlerts");
  log("automation", "hourly-watch", alerts.length + " alerts, " + res.added.length + " added, " + res.changed.length + " date changes, " + hot.length + " mailed");
  return { alerts: alerts.length, added: res.added.length, changed: res.changed.length, mailed: hot.length };
}
function dailyDigest() {
  var w = hourlyWatch(), reg = getBlob("register") || { data: {} }, ts = (reg.data && reg.data.tenders) || [];
  var tz = "Asia/Kolkata", today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd"), d3 = Utilities.formatDate(new Date(Date.now() + 3 * 864e5), tz, "yyyy-MM-dd"), d30 = Utilities.formatDate(new Date(Date.now() + 30 * 864e5), tz, "yyyy-MM-dd");
  var LIVE = ["identified", "preparing", "submitted", "technical", "ra"];
  var since = Date.now() - 26 * 36e5;
  var fresh = ts.filter(function (t) { return (t.history || []).some(function (h) { return h.by === "automation" && /Added/.test(h.what) && new Date(h.at).getTime() > since; }); });
  var closing = ts.filter(function (t) { return ["identified", "preparing"].indexOf(t.status) >= 0 && t.closing && t.closing >= today && t.closing <= d3; }).sort(function (a, b) { return a.closing < b.closing ? -1 : 1; });
  var ra = ts.filter(function (t) { return t.ra && t.ra.slice(0, 10) === today; });
  var pre = ts.filter(function (t) { return t.preBid && t.preBid.slice(0, 10) >= today && t.preBid.slice(0, 10) <= d3; });
  var refund = ts.filter(function (t) { return t.emdMode === "required" && Number(t.emdAmount) > 0 && t.emdStatus === "paid" && ["not_awarded", "not_attended"].indexOf(t.status) >= 0; });
  var pbg = ts.filter(function (t) { return t.pbgValidity && t.pbgValidity >= today && t.pbgValidity <= d30 && t.pbgStatus === "submitted"; });
  var live = ts.filter(function (t) { return LIVE.indexOf(t.status) >= 0 && (!t.closing || t.closing >= today); });
  var html = "<p>Good morning. Here is today's tender summary for Rivera.</p>" +
    '<p style="font-size:15px"><b>' + live.length + "</b> live bids · <b>" + closing.length + "</b> closing in 3 days · <b>" + ra.length + "</b> reverse auctions today · <b>" + fresh.length + "</b> new matches added</p>" +
    tableHtml("New tenders added since yesterday", ["Bid / tender", "Portal", "Buyer", "Item", "Closing"], fresh.map(function (t) { return rowHtml([esc(t.bid), esc(t.portal), esc(t.org), esc(t.items), dmyS(t.closing)]); })) +
    tableHtml("Closing within 3 days", ["Bid / tender", "Buyer", "Item", "Closing", "Status"], closing.map(function (t) { return rowHtml([esc(t.bid), esc(t.org), esc(t.items), "<b>" + dmyS(t.closing) + "</b>", esc(t.status)]); })) +
    tableHtml("Reverse auction today", ["Bid / tender", "Buyer", "Item"], ra.map(function (t) { return rowHtml([esc(t.bid), esc(t.org), esc(t.items)]); })) +
    tableHtml("Pre-bid meetings (next 3 days)", ["Bid / tender", "Buyer", "Pre-bid"], pre.map(function (t) { return rowHtml([esc(t.bid), esc(t.org), dmyS(t.preBid)]); })) +
    tableHtml("EMD to get back", ["Bid / tender", "Buyer", "EMD ₹", "Result"], refund.map(function (t) { return rowHtml([esc(t.bid), esc(t.org), Number(t.emdAmount).toLocaleString("en-IN"), esc(t.status)]); })) +
    tableHtml("Performance guarantees expiring in 30 days", ["Bid / tender", "Buyer", "PBG ₹", "Expiry"], pbg.map(function (t) { return rowHtml([esc(t.bid), esc(t.org), Number(t.pbgAmount || 0).toLocaleString("en-IN"), dmyS(t.pbgValidity)]); })) +
    '<p style="margin-top:16px">' + btn(appUrl().replace(/\/exec.*/, "/exec"), "Open " + APP, "#02315B") + "</p>";
  mail(digestTo(), APP + " — tender summary " + dmyS(today), html);
  props().setProperty("DIGEST_LAST", new Date().toISOString());
  log("automation", "daily-digest", "sent to " + digestTo());
  return { ok: true, live: live.length, closing: closing.length, fresh: fresh.length, watch: w };
}
function installAutomation() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (["hourlyWatch", "dailyDigest"].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("hourlyWatch").timeBased().everyHours(1).create();
  ScriptApp.newTrigger("dailyDigest").timeBased().atHour(8).nearMinute(30).everyDays(1).inTimezone("Asia/Kolkata").create();
  props().setProperty("AUTO_ON", new Date().toISOString());
  return { ok: true };
}
function automationState() {
  var on = false; try { on = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "hourlyWatch"; }); } catch (e) { }
  return { on: on, digestTo: digestTo(), last: props().getProperty("DIGEST_LAST") || "", since: props().getProperty("AUTO_ON") || "" };
}

function api(d) {
  var a = d.action;
  if (a === "ping") return { ok: true, app: APP, setup: !adminReady() };
  if (a === "register") {
    var email = cleanEmail(d.email), name = String(d.name || "").trim().slice(0, 80), pw = String(d.pw || "");
    if (email !== ADMIN) throw "Logins are created by the admin. Ask crm@rivera.co.in for your username and password.";
    if (adminReady()) throw "The admin account is already set up — sign in.";
    if (!name) throw "Enter your name"; if (pw.length < 40) throw "Password not accepted";
    var cache = CacheService.getScriptCache(), k = "reg:" + email; if (cache.get(k)) throw "A code was just sent. Check your inbox (and spam), then try again in a minute.";
    cache.put(k, "1", 60);
    var u = findUser(email) || { email: email, created: new Date(), role: "admin", fails: 0 };
    u.name = name; u.salt = Utilities.getUuid(); u.hash = hashPw(pw, u.salt); u.status = "unverified"; u.role = "admin"; u.contact = ADMIN; u.code = code6(); u.codeExp = Date.now() + 30 * 6e4;
    saveUser(u); log(email, "admin-setup", name);
    mail(email, APP + " — your verification code " + u.code, "<p>Hello " + esc(name) + ",</p><p>Your admin verification code is</p><p style='font-size:28px;font-weight:bold;letter-spacing:4px'>" + u.code + "</p><p>It is valid for 30 minutes.</p>");
    return { ok: true, next: "verify" };
  }
  if (a === "verify") {
    var email2 = cleanEmail(d.email), u2 = findUser(email2); if (!u2 || email2 !== ADMIN) throw "Not allowed";
    if (!u2.code || Number(u2.codeExp) < Date.now()) throw "Code expired — request a new one";
    if (!eq(String(d.code || "").trim(), u2.code)) { u2.fails = Number(u2.fails || 0) + 1; saveUser(u2); if (u2.fails >= MAX_FAIL) { u2.code = ""; saveUser(u2); throw "Too many wrong codes — request a new one"; } throw "Wrong code"; }
    u2.code = ""; u2.fails = 0; u2.status = "approved"; u2.role = "admin"; u2.approvedBy = "self (admin mailbox)"; u2.lastLogin = new Date(); saveUser(u2); log(email2, "admin-verified", "");
    var s2 = newSession(u2, d.device, "approved", "self");
    return { ok: true, status: "approved", token: token(u2, s2.sid), user: pub(u2) };
  }
  if (a === "login") {
    var id3 = cleanEmail(d.email), u3 = findUser(id3);
    if (!u3 || u3.status === "unverified") throw "Wrong username or password";
    if (Number(u3.lockUntil || 0) > Date.now()) throw "Too many attempts — try again after " + Math.ceil((u3.lockUntil - Date.now()) / 6e4) + " min";
    if (!eq(hashPw(String(d.pw || ""), u3.salt), u3.hash)) { u3.fails = Number(u3.fails || 0) + 1; if (u3.fails >= MAX_FAIL) { u3.lockUntil = Date.now() + LOCK_MIN * 6e4; u3.fails = 0; log(id3, "locked", ""); } saveUser(u3); log(id3, "login-fail", ""); throw "Wrong username or password"; }
    u3.fails = 0; u3.lockUntil = ""; saveUser(u3);
    if (u3.status !== "approved") { log(id3, "login-blocked", u3.status); throw "This login is disabled. Contact crm@rivera.co.in."; }
    if (u3.role === "admin") { u3.lastLogin = new Date(); saveUser(u3); var sa = newSession(u3, d.device, "approved", "admin"); log(id3, "login", d.device || ""); return { ok: true, status: "approved", token: token(u3, sa.sid), user: pub(u3) }; }
    var s3 = newSession(u3, d.device, "pending", ""); log(id3, "login-request", d.device || "");
    mail(ADMIN, "[" + APP + "] Sign-in request: " + u3.name + " (" + id3 + ")", "<h2 style='margin:0 0 8px'>Sign-in request</h2><p><b>" + esc(u3.name) + "</b> (" + esc(id3) + ") is signing in" + (d.device ? " on <b>" + esc(d.device) + "</b>" : "") + " at " + new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST.</p><p>" + btn(sessLink("sapprove", s3.sid), "Approve sign-in", "#1a7f37") + btn(sessLink("sreject", s3.sid), "Reject", "#b42318") + "</p><p style='font-size:12px;color:#666'>If this wasn't expected, reject it and reset their password in the app ▸ Users & access.</p>");
    return { ok: true, status: "waiting", sid: s3.sid, nonce: s3.nonce };
  }
  if (a === "loginStatus") {
    var s4 = findSession(String(d.sid || "")); if (!s4 || !eq(String(d.nonce || ""), s4.nonce)) throw "Sign-in request not found — sign in again";
    if (s4.status === "pending") return { ok: true, status: "waiting" };
    if (s4.status !== "approved") return { ok: true, status: s4.status };
    var u4 = findUser(s4.user); if (!u4 || u4.status !== "approved") return { ok: true, status: "rejected" };
    if (!s4.lastSeen) { u4.lastLogin = new Date(); saveUser(u4); s4.lastSeen = new Date(); saveSession(s4); }
    return { ok: true, status: "approved", token: token(u4, s4.sid), user: pub(u4) };
  }
  if (a === "forgot") {
    var email5 = cleanEmail(d.email); if (email5 !== ADMIN) throw "Ask the admin (crm@rivera.co.in) to reset your password.";
    var u5 = findUser(email5), c5 = CacheService.getScriptCache();
    if (u5 && u5.status === "approved" && !c5.get("fg:" + email5)) { c5.put("fg:" + email5, "1", 60); u5.code = code6(); u5.codeExp = Date.now() + 30 * 6e4; saveUser(u5); mail(email5, APP + " — password reset code " + u5.code, "<p>Your password reset code is</p><p style='font-size:28px;font-weight:bold;letter-spacing:4px'>" + u5.code + "</p><p>Valid for 30 minutes.</p>"); log(email5, "forgot", ""); }
    return { ok: true };
  }
  if (a === "reset") {
    var email6 = cleanEmail(d.email), u6 = findUser(email6); if (email6 !== ADMIN || !u6 || !u6.code || Number(u6.codeExp) < Date.now()) throw "Code expired — request a new one";
    if (!eq(String(d.code || "").trim(), u6.code)) { u6.fails = Number(u6.fails || 0) + 1; if (u6.fails >= MAX_FAIL) u6.code = ""; saveUser(u6); throw "Wrong code"; }
    if (String(d.pw || "").length < 40) throw "Password not accepted";
    u6.salt = Utilities.getUuid(); u6.hash = hashPw(d.pw, u6.salt); u6.code = ""; u6.fails = 0; u6.lockUntil = ""; saveUser(u6); log(email6, "password-reset", "");
    return { ok: true };
  }
  /* ---- private document store (seeded once from Dropbox with a short-lived key) ---- */
  if (a === "filePut" && d.seed) { if (!seedOk(d.seed)) throw "Seed key expired"; return filePut(d, "dropbox-seed", true); }
  if (a === "fileList" && d.seed) { if (!seedOk(d.seed)) throw "Seed key expired"; return { ok: true, files: fileList() }; }
  /* ---- signed-in actions ---- */
  var me = auth(d.token, false);
  if (a === "me") return { ok: true, user: pub(me), settings: { loginMail: cfg("loginMail", "1") === "1" } };
  if (a === "logout") { var so = findSession(me.sid); if (so) { so.status = "ended"; so.decidedAt = new Date(); so.decidedBy = "signed out"; saveSession(so); } log(me.email, "logout", ""); return { ok: true }; }
  if (a === "pack") { var p = getBlob("datapack"); return { ok: true, pack: p }; }
  if (a === "fileList") return { ok: true, files: fileList() };
  if (a === "fileAdd") { if (String(d.kind || "doc") !== "doc") throw "Only documents can be added"; var ra = filePut(d, me.email, false); if (!ra.exists) log(me.email, "file-add", String(d.name || d.id).slice(0, 120)); return ra; }
  if (a === "fileGet") return fileGet(String(d.id || ""));
  if (a === "gemAlerts") {
    var gc = CacheService.getScriptCache(), hit = gc.get("gemAlerts");
    if (hit && !d.fresh) return { ok: true, alerts: JSON.parse(hit), cached: true };
    var out = [], seen = {}, th = GmailApp.search('("GEM/20" OR from:gem.gov.in OR from:bidplus.gem.gov.in) newer_than:60d', 0, 80);
    th.forEach(function (t) { t.getMessages().forEach(function (m) {
      var subj = m.getSubject() || "", txt = subj + "\n" + (m.getPlainBody() || ""), re = /GEM\/\d{4}\/[BR]\/\d{5,}/g, mm, hits = [];
      while ((mm = re.exec(txt))) hits.push({ id: mm[0], at: mm.index, end: mm.index + mm[0].length });
      hits.forEach(function (h, i) {
        if (seen[h.id]) return; seen[h.id] = 1;
        var prevEnd = i ? hits[i - 1].end : 0, next = i + 1 < hits.length ? hits[i + 1].at : txt.length;
        var back = txt.slice(Math.max(prevEnd, h.at - 120), h.at), fwd = txt.slice(h.end, Math.min(next, h.end + 700));
        var ctx = (back + " " + h.id + " " + fwd).replace(/\s+/g, " ");
        var date = (fwd.match(/\d{2}[-\/]\d{2}[-\/]\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?/) || [""])[0];
        var link = (fwd.match(/https?:\/\/[^\s"'<>]*gem\.gov\.in[^\s"'<>]*/i) || [""])[0];
        out.push({ bid: h.id, subject: subj.slice(0, 200), ctx: ctx.slice(0, 700), item: fwd.replace(/\s+/g, " ").replace(/^[\s:.,-]*(item\s*:?\s*)?/i, "").split(/bid end|end date|https?:|\bview\b/i)[0].slice(0, 160).trim(), end: date, link: link, date: m.getDate().toISOString(), from: String(m.getFrom()).slice(0, 80) });
      });
    }); });
    var js = JSON.stringify(out); if (js.length < 95000) gc.put("gemAlerts", js, 600);
    log(me.email, "gem-alerts", out.length + " bids");
    return { ok: true, alerts: out };
  }
  if (a === "tenderAlerts") {
    var tc = CacheService.getScriptCache(), th2 = tc.get("tenderAlerts");
    if (th2 && !d.fresh) return { ok: true, alerts: JSON.parse(th2), cached: true };
    var al = scanTenderMail(), js2 = JSON.stringify(al); if (js2.length < 95000) tc.put("tenderAlerts", js2, 600);
    log(me.email, "tender-alerts", al.length + " alerts"); return { ok: true, alerts: al, auto: (function () { try { return automationState(); } catch (e) { return { on: false }; } })() };
  }
  if (a === "sync") {
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var cur = getBlob("register") || { quotes: [], data: {}, deleted: [] }, inc = d.snapshot || {};
      var del = {}; (cur.deleted || []).concat(inc.deleted || []).slice(-3000).forEach(function (k) { del[k] = 1; });
      cur.quotes = mergeList(cur.quotes, inc.quotes).filter(function (q) { return !del[q.id]; });
      cur.data = cur.data || {}; var keys = {}; Object.keys(cur.data).concat(Object.keys(inc.data || {})).forEach(function (c) { if (/^[a-z]{2,20}$/.test(c)) keys[c] = 1; });
      Object.keys(keys).forEach(function (c) { cur.data[c] = mergeList(cur.data[c], (inc.data || {})[c]).filter(function (x) { return !del[c + ":" + x.id]; }); });
      cur.deleted = Object.keys(del); cur.savedAt = new Date().toISOString(); cur.by = me.email;
      if (inc.settings && Number(inc.settings.updatedAt || 0) > Number((cur.settings || {}).updatedAt || 0)) cur.settings = inc.settings;
      putBlob("register", cur); return { ok: true, register: cur };
    } finally { lock.releaseLock(); }
  }
  if (a === "password") { if (!eq(hashPw(String(d.old || ""), me.salt), me.hash)) throw "Current password is wrong"; if (String(d.pw || "").length < 40) throw "Password not accepted"; me.salt = Utilities.getUuid(); me.hash = hashPw(d.pw, me.salt); saveUser(me); log(me.email, "password-change", ""); return { ok: true }; }
  /* ---- admin ---- */
  auth(d.token, true);
  if (a === "users") { var v = users().getDataRange().getValues(), out = []; for (var i = 1; i < v.length; i++) { var x = {}; UH.forEach(function (k, j) { x[k] = v[i][j]; }); if (x.email) out.push(pub(x)); } return { ok: true, users: out }; }
  if (a === "createUser") {
    var nid = cleanId(d.email), nn = String(d.name || "").trim().slice(0, 80); if (!nn) throw "Enter the person's name"; if (String(d.pw || "").length < 40) throw "Password not accepted";
    if (findUser(nid)) throw "That username already exists";
    var role = ["admin", "sales", "viewer"].indexOf(d.role) >= 0 ? d.role : "sales";
    var nu = { email: nid, name: nn, contact: String(d.contact || "").trim().slice(0, 120), role: role, status: "approved", created: new Date(), fails: 0, approvedBy: me.email, salt: Utilities.getUuid() }; nu.hash = hashPw(d.pw, nu.salt);
    saveUser(nu); log(me.email, "create-user", nid + " " + role); return { ok: true, user: pub(nu) };
  }
  if (a === "setUser") {
    var tu = findUser(cleanEmail(d.email)); if (!tu) throw "No such user";
    if (tu.email === ADMIN && (d.status && d.status !== "approved" || d.role && d.role !== "admin")) throw "The main admin account can't be changed";
    if (d.status) { if (["approved", "revoked"].indexOf(d.status) < 0) throw "Bad status"; tu.status = d.status; if (d.status === "approved") tu.approvedBy = me.email; }
    if (d.role) { if (["admin", "sales", "viewer"].indexOf(d.role) < 0) throw "Bad role"; tu.role = d.role; }
    if (d.name) tu.name = String(d.name).trim().slice(0, 80);
    if (d.contact !== undefined) tu.contact = String(d.contact || "").trim().slice(0, 120);
    if (d.pw) { if (String(d.pw).length < 40) throw "Password not accepted"; tu.salt = Utilities.getUuid(); tu.hash = hashPw(d.pw, tu.salt); tu.fails = 0; tu.lockUntil = ""; }
    saveUser(tu); log(me.email, "set-user", tu.email + " " + (d.status || "") + " " + (d.role || "") + (d.pw ? " password-reset" : "")); return { ok: true, user: pub(tu) };
  }
  if (a === "deleteUser") { var du = findUser(cleanEmail(d.email)); if (!du || du.email === ADMIN) throw "Can't delete"; users().deleteRow(du.row); log(me.email, "delete-user", du.email); return { ok: true }; }
  if (a === "sessions") { var sv = sessions().getDataRange().getValues().slice(1), so2 = []; sv.forEach(function (r) { var s = {}; SH.forEach(function (k, j) { s[k] = r[j]; }); if (s.sid) so2.push(pubS(s)); }); so2.reverse(); return { ok: true, sessions: so2.filter(function (s) { return s.status === "pending" || s.status === "approved"; }).concat(so2.filter(function (s) { return s.status !== "pending" && s.status !== "approved"; }).slice(0, 60)) }; }
  if (a === "setSession") { var ss2 = findSession(String(d.sid || "")); if (!ss2) throw "Not found"; if (["approved", "rejected", "revoked"].indexOf(d.status) < 0) throw "Bad status"; ss2.status = d.status; ss2.decidedAt = new Date(); ss2.decidedBy = me.email; saveSession(ss2); log(me.email, "session-" + d.status, ss2.user + " " + ss2.device); return { ok: true }; }
  if (a === "log") { var lv = sheet("Log", ["time", "email", "action", "detail"]).getDataRange().getValues().slice(1).slice(-300).reverse(); return { ok: true, log: lv.map(function (r) { return { time: new Date(r[0]).toISOString(), email: r[1], action: r[2], detail: r[3] }; }) }; }
  if (a === "filePut") return filePut(d, me.email, true);
  if (a === "fileDel") { fileDel(String(d.id || "")); log(me.email, "file-delete", d.id); return { ok: true }; }
  if (a === "putPack") { if (!d.pack || d.pack.kind !== "rivera-datapack") throw "Not a Rivera data pack"; putBlob("datapack", d.pack); log(me.email, "datapack-upload", ""); return { ok: true }; }
  if (a === "config") { if (d.loginMail !== undefined) props().setProperty("CFG_loginMail", d.loginMail ? "1" : "0"); return { ok: true }; }
  if (a === "automation") {
    if (d.digestTo !== undefined) { var lst = String(d.digestTo || "").split(/[\s,;]+/).filter(function (x) { return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(x); }).slice(0, 10).join(","); props().setProperty("CFG_digestTo", lst); }
    if (d.op === "on") { installAutomation(); log(me.email, "automation-on", digestTo()); }
    if (d.op === "off") { ScriptApp.getProjectTriggers().forEach(function (t) { if (["hourlyWatch", "dailyDigest"].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); }); log(me.email, "automation-off", ""); }
    var r2 = {}; if (d.op === "run") r2 = hourlyWatch(); if (d.op === "digest") r2 = dailyDigest();
    return { ok: true, state: automationState(), result: r2 };
  }
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
    var sid = String(p.e || ""), body = p.a + "|" + sid + "|" + p.x;
    if (!eq(hmac(body), p.s || "") || Number(p.x) < Date.now()) return page("Link expired", "This link is invalid or expired. Open the app ▸ Users & access instead.", "#b42318");
    var s = findSession(sid); if (!s) return page("Not found", "This sign-in request no longer exists.", "#b42318");
    var u = findUser(s.user) || { name: s.user };
    if (s.status !== "pending") return page("Already decided", esc(u.name) + " — this sign-in is already <b>" + esc(s.status) + "</b>.", "#02A9F0");
    var label = p.a === "sapprove" ? "Approve sign-in" : "Reject sign-in";
    if (p.c !== "1") {
      var hid = ["a", "e", "x", "s"].map(function (k) { return '<input type="hidden" name="' + k + '" value="' + esc(p[k]) + '">'; }).join("") + '<input type="hidden" name="c" value="1">';
      return page(label + "?", "<b>" + esc(u.name) + "</b> (" + esc(s.user) + ") on " + esc(s.device || "a device") + " · requested " + new Date(s.created).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST.</p><form method=\"get\" action=\"" + appUrl() + "\" target=\"_top\">" + hid + '<button style="padding:10px 18px;border:0;border-radius:6px;background:' + (p.a === "sapprove" ? "#1a7f37" : "#b42318") + ';color:#fff;font-weight:bold;font-size:15px;cursor:pointer">' + label + "</button></form><p>", "#02A9F0");
    }
    s.status = p.a === "sapprove" ? "approved" : "rejected"; s.decidedAt = new Date(); s.decidedBy = ADMIN + " (email)"; saveSession(s); log(ADMIN, "session-" + s.status + "-email", s.user + " " + s.device);
    return page(p.a === "sapprove" ? "Sign-in approved" : "Sign-in rejected", "<b>" + esc(u.name) + "</b> " + (p.a === "sapprove" ? "is now signed in on " + esc(s.device || "their device") + ". They stay signed in until they sign out." : "was not let in."), p.a === "sapprove" ? "#1a7f37" : "#b42318");
  } catch (err) { return page("Error", esc(String(err)), "#b42318"); }
}
/** Run once from the editor to create the sheets and grant permissions. */
function setup() { secret(); users(); sessions(); sheet("Log", ["time", "email", "action", "detail"]); sheet("Store", ["key", "updated", "chunks..."]); Logger.log("Ready. Sheet: " + ss().getUrl()); }
