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
var UH = ["email", "name", "salt", "hash", "status", "role", "created", "lastLogin", "code", "codeExp", "fails", "lockUntil", "approvedBy", "contact", "mustChange"];
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
function pub(u) { return { email: u.email, contact: u.contact || "", name: u.name, status: u.status, role: u.role, created: u.created ? new Date(u.created).toISOString() : "", lastLogin: u.lastLogin ? new Date(u.lastLogin).toISOString() : "", approvedBy: u.approvedBy || "", mustChange: String(u.mustChange || "") === "1" }; }
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
  if (/^GEM\//.test(id)) return "GeM"; var fr = String(from || "").toLowerCase();
  if (/tender247/.test(fr)) return "Tender247"; if (/tendertiger/.test(fr)) return "TenderTiger"; if (/bidassist/.test(fr)) return "BidAssist"; if (/tendersinfo/.test(fr)) return "TendersInfo"; if (/tenderdetail/.test(fr)) return "TenderDetail"; if (/gem\.gov\.in/.test(fr)) return "GeM";
  if (/^\d{6,9}$/.test(id) && /t247/i.test(String(txt || ""))) return "Tender247";
  var f = fr + " " + String(txt || "").slice(0, 400).toLowerCase();
  if (/coalindia/.test(f)) return "Coal India e-proc"; if (/eprocure\.gov\.in|cppp/.test(f)) return "CPPP"; if (/ntpc/.test(f)) return "NTPC"; if (/bhel/.test(f)) return "BHEL";
  if (/tender247/.test(f)) return "Tender247"; if (/tendertiger/.test(f)) return "TenderTiger"; if (/bidassist/.test(f)) return "BidAssist"; if (/nic\.in/.test(f)) return "State / NIC e-proc";
  return "Email alert";
}
function scanTenderMail() { return alertsFromThreads(GmailApp.search(TENDER_Q, 0, 120), kwList()); }
function alertsFromThreads(th, kw) {
  var out = [], seen = {};
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
        var emd = blk.match(/EMD[^0-9₹\n]{0,25}(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr)?/i);
        var val = blk.match(/(?:estimated (?:bid )?value|tender value|ECV|bid value|value of (?:the )?(?:tender|work))[^0-9₹\n]{0,25}(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr)?/i);
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
  var alerts = scanTenderMail(), tw = tdbWatch(alerts), res = applyAlerts(alerts.concat(tw.gemAlerts || [])), P = props();
  alerts = alerts.concat(tw.gemAlerts || []);
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
  log("automation", "hourly-watch", alerts.length + " alerts, " + res.added.length + " added, " + res.changed.length + " date changes, " + hot.length + " mailed; database +" + tw.email + " email, +" + tw.gem + " GeM, +" + tw.results + " results");
  return { alerts: alerts.length, added: res.added.length, changed: res.changed.length, mailed: hot.length, db: { email: tw.email, gem: tw.gem, results: tw.results } };
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
  var gemNew = ""; try { gemNew = gemNewHtml(); } catch (e) { }
  html = html.replace("<p style=\"margin-top:16px\">", gemNew + "<p style=\"margin-top:16px\">");
  mail(digestTo(), APP + " — tender summary " + dmyS(today), html);
  try {
    var emdPay = ts.filter(function (t) { return t.emdMode === "required" && Number(t.emdAmount) > 0 && (t.emdStatus || "to_pay") === "to_pay" && LIVE.indexOf(t.status) >= 0 && (!t.closing || t.closing >= today); });
    var awarded = ts.filter(function (t) { return t.status === "awarded" && !/complet|closed|deliver/i.test(String(t.execStatus || "")); });
    roleDigests({ gemNew: gemNew,
      fresh: tableHtml("New tenders added since yesterday", ["Bid / tender", "Portal", "Buyer", "Item", "Closing"], fresh.map(function (t) { return rowHtml([esc(t.bid), esc(t.portal), esc(t.org), esc(t.items), dmyS(t.closing)]); })),
      closing: tableHtml("Closing within 3 days", ["Bid / tender", "Buyer", "Item", "Closing", "Status"], closing.map(function (t) { return rowHtml([esc(t.bid), esc(t.org), esc(t.items), "<b>" + dmyS(t.closing) + "</b>", esc(t.status)]); })),
      ra: tableHtml("Reverse auction today", ["Bid / tender", "Buyer", "Item"], ra.map(function (t) { return rowHtml([esc(t.bid), esc(t.org), esc(t.items)]); })),
      pre: tableHtml("Pre-bid meetings (next 3 days)", ["Bid / tender", "Buyer", "Pre-bid"], pre.map(function (t) { return rowHtml([esc(t.bid), esc(t.org), dmyS(t.preBid)]); })),
      emdPay: tableHtml("EMD to pay for live bids", ["Bid / tender", "Buyer", "EMD ₹", "Closing"], emdPay.map(function (t) { return rowHtml([esc(t.bid), esc(t.org), Number(t.emdAmount).toLocaleString("en-IN"), dmyS(t.closing)]); })),
      refund: tableHtml("EMD to get back", ["Bid / tender", "Buyer", "EMD ₹", "Result"], refund.map(function (t) { return rowHtml([esc(t.bid), esc(t.org), Number(t.emdAmount).toLocaleString("en-IN"), esc(t.status)]); })),
      pbg: tableHtml("Performance guarantees expiring in 30 days", ["Bid / tender", "Buyer", "PBG ₹", "Expiry"], pbg.map(function (t) { return rowHtml([esc(t.bid), esc(t.org), Number(t.pbgAmount || 0).toLocaleString("en-IN"), dmyS(t.pbgValidity)]); })),
      awarded: tableHtml("Awarded orders to execute", ["Bid / tender", "Buyer", "Item", "Value ₹"], awarded.map(function (t) { return rowHtml([esc(t.bid), esc(t.org), esc(t.items), Number(t.ourPrice || t.value || 0).toLocaleString("en-IN")]); })) });
  } catch (e) { log("automation", "role-digest-error", String(e)); }
  props().setProperty("DIGEST_LAST", new Date().toISOString());
  log("automation", "daily-digest", "sent to " + digestTo());
  return { ok: true, live: live.length, closing: closing.length, fresh: fresh.length, watch: w };
}
function installAutomation() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (["hourlyWatch", "dailyDigest", "gemSweepJob"].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("hourlyWatch").timeBased().everyHours(1).create();
  try { gemSweepInstall(); } catch (e) { }
  ScriptApp.newTrigger("dailyDigest").timeBased().atHour(8).nearMinute(30).everyDays(1).inTimezone("Asia/Kolkata").create();
  props().setProperty("AUTO_ON", new Date().toISOString());
  return { ok: true };
}
function automationState() {
  var on = false; try { on = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "hourlyWatch"; }); } catch (e) { }
  return { on: on, digestTo: digestTo(), last: props().getProperty("DIGEST_LAST") || "", since: props().getProperty("AUTO_ON") || "" };
}

/* ================= Tender database (Tender247-style) =================
 * TenderDB       — every tender ever seen: email alerts (GeM, CPPP, Coal India, NIC, Tender247 …), GeM direct search,
 *                  Excel imports and Rivera's own register. Rows are never deleted, so closed tenders become the archive.
 * TenderResults  — award / L1 / every bidder's price: result mails, Excel imports, manual entry and Rivera's recorded results.
 * hourlyWatch() feeds both; tdbBackfill() reads up to 3 years of old alert mails once (runs itself every 10 min until done).
 */
var TDH = ["key", "bid", "portal", "org", "item", "state", "city", "value", "emd", "published", "closing", "preBid", "fit", "link", "source", "firstSeen", "lastSeen", "corr", "status", "subject"];
var TRH = ["key", "bid", "org", "item", "bidder", "rank", "price", "awarded", "resultDate", "source", "by", "added", "note"];
var TDB_Q_ALL = TENDER_Q.replace(/newer_than:\d+d/, "newer_than:1100d");
var RESULT_Q = '(subject:result OR subject:award OR subject:awarded OR subject:"L1" OR subject:"price bid" OR subject:"financial bid" OR subject:"bid status" OR subject:"evaluation" OR subject:contract) ("GEM/20" OR from:gem.gov.in OR from:eprocure.gov.in OR from:nic.in OR from:coalindia.in OR from:tender247.com OR from:tendertiger.com OR from:bidassist.com OR from:tendersinfo.com) ';
var STATES = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Delhi", "Jammu and Kashmir", "Ladakh", "Puducherry", "Chandigarh", "Andaman and Nicobar"];
var STATE_HINT = [[/\bncl\b|singrauli/i, "Madhya Pradesh"], [/\bmcl\b|talcher|sambalpur|orissa/i, "Odisha"], [/\bsecl\b|bilaspur|korba/i, "Chhattisgarh"], [/\bwcl\b|nagpur|chandrapur/i, "Maharashtra"], [/\bccl\b|\bbccl\b|ranchi|dhanbad|bokaro/i, "Jharkhand"], [/\becl\b|asansol|durgapur|kolkata/i, "West Bengal"], [/tangedco|tneb|tnpdcl|neyveli|nlc|chennai|mettur|tuticorin|erode|coimbatore/i, "Tamil Nadu"], [/kseb|cochin|kochi/i, "Kerala"], [/kpcl|bangalore|bengaluru|raichur/i, "Karnataka"], [/apgenco|vizag|visakhapatnam|vijayawada/i, "Andhra Pradesh"], [/tsgenco|hyderabad|singareni|sccl/i, "Telangana"], [/mahagenco|mumbai|pune/i, "Maharashtra"], [/gsecl|ahmedabad|vadodara/i, "Gujarat"], [/rvunl|jaipur|kota/i, "Rajasthan"], [/uprvunl|lucknow|anpara|obra/i, "Uttar Pradesh"]];
function stateOf(t) {
  t = String(t || ""); for (var i = 0; i < STATES.length; i++) if (new RegExp("\\b" + STATES[i].replace(/ and /, " (and|&) ") + "\\b", "i").test(t)) return STATES[i];
  for (var j = 0; j < STATE_HINT.length; j++) if (STATE_HINT[j][0].test(t)) return STATE_HINT[j][1];
  if (/\btamilnadu\b/i.test(t)) return "Tamil Nadu"; return "";
}
function tdbFmt(sh, n) { var p = "FMT_" + sh.getName(); if (props().getProperty(p)) return; sh.getRange(1, 1, sh.getMaxRows(), n).setNumberFormat("@"); sh.setFrozenRows(1); props().setProperty(p, "1"); }
function tdbSheet() { var sh = sheet("TenderDB", TDH); tdbFmt(sh, TDH.length); return sh; }
function trSheet() { var sh = sheet("TenderResults", TRH); tdbFmt(sh, TRH.length); return sh; }
function tkey(bid) { return String(bid || "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function nkey(s) { return String(s || "").toLowerCase().replace(/\b(m\/s|messrs|pvt|private|ltd|limited|llp|inc|co|company|the)\b\.?/g, "").replace(/[^a-z0-9]+/g, ""); }
function todayIST() { return Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd"); }
function cellStr(x) { return x instanceof Date ? Utilities.formatDate(x, "Asia/Kolkata", "yyyy-MM-dd") : x === null || x === undefined ? "" : x; }
function readTable(sh, H) {
  var v = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) { if (!v[i][0]) continue; var o = {}; for (var j = 0; j < H.length; j++) o[H[j]] = cellStr(v[i][j]); out.push(o); }
  return out;
}
function writeTable(sh, H, rows) {
  var last = sh.getLastRow(); if (last > 1) sh.getRange(2, 1, last - 1, H.length).clearContent();
  if (!rows.length) return;
  if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
  sh.getRange(2, 1, rows.length, H.length).setNumberFormat("@").setValues(rows.map(function (r) { return H.map(function (k) { var x = r[k]; return x === undefined || x === null ? "" : String(x).slice(0, 1000); }); }));
}
function tstatus(r, today) { if (/cancel/i.test(r.status || "")) return "cancelled"; return r.closing && String(r.closing) < today ? "closed" : "live"; }
function clean(s, n) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, n || 300); }

function tdbUpsert(rows, source) {
  rows = (rows || []).filter(function (a) { return a && tkey(a.bid).length >= 5; });
  if (!rows.length) return { added: 0, updated: 0 };
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var sh = tdbSheet(), all = readTable(sh, TDH), by = {}, now = new Date().toISOString(), today = todayIST(), added = 0, updated = 0;
    all.forEach(function (r) { by[r.key] = r; });
    rows.forEach(function (a) {
      var k = tkey(a.bid), r = by[k];
      var inc = { bid: clean(a.bid, 80), portal: clean(a.portal, 40), org: clean(a.org, 160), item: clean(a.item, 400), state: clean(a.state || stateOf((a.org || "") + " " + (a.item || "") + " " + (a.city || "")), 40), city: clean(a.city, 60),
        value: Number(a.value) || "", emd: Number(a.emd) || "", published: clean(a.published, 10), closing: clean(a.closing, 10), preBid: clean(a.preBid, 10), fit: Number(a.fit) || 0, link: clean(a.link, 400), subject: clean(a.subject, 200), status: a.status || "" };
      if (!r) {
        r = { key: k, source: source, firstSeen: now, lastSeen: now, corr: 0 }; TDH.forEach(function (f) { if (r[f] === undefined) r[f] = inc[f] === undefined ? "" : inc[f]; });
        r.status = tstatus(r, today); by[k] = r; all.push(r); added++; return;
      }
      ["portal", "org", "item", "state", "city", "value", "emd", "published", "preBid", "link", "subject"].forEach(function (f) { if (inc[f] && (!r[f] || (f === "item" && String(inc[f]).length > String(r[f]).length + 20))) r[f] = inc[f]; });
      if (inc.closing && inc.closing !== r.closing && (!r.closing || inc.closing > r.closing)) { if (r.closing) r.corr = Number(r.corr || 0) + 1; r.closing = inc.closing; }
      if (inc.fit > Number(r.fit || 0)) r.fit = inc.fit;
      if (/cancel/i.test(inc.status)) r.status = "cancelled";
      if (String(r.source || "").indexOf(source) < 0) r.source = (r.source ? r.source + ", " : "") + source;
      r.lastSeen = now; r.status = tstatus(r, today); updated++;
    });
    all.forEach(function (r) { r.status = tstatus(r, today); });
    writeTable(sh, TDH, all);
    return { added: added, updated: updated, total: all.length };
  } finally { lock.releaseLock(); }
}
function trUpsert(rows, by) {
  rows = (rows || []).filter(function (a) { return a && tkey(a.bid).length >= 5 && (a.bidder || a.price); });
  if (!rows.length) return { added: 0, updated: 0 };
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var sh = trSheet(), all = readTable(sh, TRH), m = {}, added = 0, updated = 0, now = new Date().toISOString();
    all.forEach(function (r) { m[r.key] = r; });
    rows.forEach(function (a) {
      var k = tkey(a.bid) + "|" + (nkey(a.bidder) || ("rank" + (a.rank || "x"))), r = m[k];
      var inc = { bid: clean(a.bid, 80), org: clean(a.org, 160), item: clean(a.item, 300), bidder: clean(a.bidder, 120), rank: Number(a.rank) || "", price: Number(a.price) || "", awarded: a.awarded === true || /^(y|yes|true|1|awarded|won|l1 \(awarded\))$/i.test(String(a.awarded || "")) ? "yes" : (a.awarded === false || /^(n|no|false|0)$/i.test(String(a.awarded || "")) ? "no" : ""), resultDate: clean(a.resultDate, 10), note: clean(a.note, 200) };
      if (!r) { r = { key: k, source: a.source || "Manual", by: by || a.by || "", added: now }; TRH.forEach(function (f) { if (r[f] === undefined) r[f] = inc[f] === undefined ? "" : inc[f]; }); m[k] = r; all.push(r); added++; return; }
      ["org", "item", "bidder", "rank", "price", "awarded", "resultDate", "note"].forEach(function (f) { if (inc[f] !== "" && inc[f] !== undefined) r[f] = inc[f]; });
      updated++;
    });
    writeTable(sh, TRH, all);
    return { added: added, updated: updated, total: all.length };
  } finally { lock.releaseLock(); }
}
function cleanItem(s) { return String(s || "").split(/\b(?:department name|organi[sz]ation(?: name)?|ministry(?: name)?|buyer|bid end date|end date|due date|closing date|emd|tender value|estimated value)\s*[:\-]/i)[0].replace(/^\s*(?:items?|title|tender brief|description)\s*[:\-]\s*/i, "").trim(); }
function alertToRow(a) { return { bid: a.bid, portal: a.portal, org: a.org, item: cleanItem(a.item) || a.subject, value: a.value, emd: a.emd, published: String(a.date || "").slice(0, 10), closing: a.closing, preBid: a.preBid, fit: a.fit, link: a.link, subject: a.subject }; }

/* ---- result mails: "L1 …", "awarded to …", bidder + price lines ---- */
function resultsFromThreads(th) {
  var out = [], ID = /GEM\/\d{4}\/[BR]\/\d{5,}|\b20\d{2}_[A-Z][A-Z0-9]{1,14}_\d{3,8}_\d{1,2}\b|(?:Tender\s*(?:ID|No\.?|Number|Ref(?:erence)?)|T247\s*ID|NIT\s*No\.?|Bid\s*No\.?)\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\/_.\-]{4,40})/gi;
  var LINE = /\b(L\s?-?(\d{1,2}))\b[\s:.\-–)]*([A-Za-z][A-Za-z0-9&.,()'\/ -]{2,90}?)\s*[-–:|,]?\s*(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr)?/gi;
  (th || []).forEach(function (t) {
    t.getMessages().forEach(function (m) {
      var subj = m.getSubject() || "", txt = subj + "\n" + (m.getPlainBody() || ""), mm, ids = [];
      if (!/result|award|\bL1\b|lowest|rank|evaluation|contract|AOC|successful bidder/i.test(txt)) return;
      ID.lastIndex = 0; while ((mm = ID.exec(txt))) { var id = (mm[1] || mm[0]).replace(/[.\-]+$/, ""); if (id.length >= 6 && /\d{3}/.test(id)) ids.push({ id: id, at: mm.index }); }
      ids.forEach(function (h, i) {
        var blk = txt.slice(h.at, i + 1 < ids.length ? ids[i + 1].at : Math.min(txt.length, h.at + 4000)), x, got = 0, date = m.getDate().toISOString().slice(0, 10);
        var org = clean((blk.match(/(?:organi[sz]ation|department|buyer|ministry|company)\s*(?:name)?\s*[:\-]\s*([^\n|]{3,90})/i) || [])[1], 160);
        var item = clean((blk.match(/(?:item(?: category)?|title|work|description|tender brief|product)\s*(?:name)?\s*[:\-]\s*([^\n|]{4,200})/i) || [])[1], 300);
        LINE.lastIndex = 0;
        while ((x = LINE.exec(blk))) { out.push({ bid: h.id, org: org, item: item, rank: Number(x[2]), bidder: clean(x[3], 120), price: money(x[4], x[5]), awarded: Number(x[2]) === 1 && /award/i.test(blk) ? "yes" : "", resultDate: date, source: "Email result" }); got++; }
        var w = blk.match(/(?:awarded to|successful bidder|selected bidder|contract (?:awarded|placed) (?:to|on)|seller name|L1 bidder|L1 seller)\s*[:\-]?\s*(?:M\/s\.?\s*)?([A-Za-z][^\n,;|]{2,90})/i);
        var p = blk.match(/(?:L1 (?:price|value|amount|rate)|lowest (?:price|bid|offer)|contract value|awarded (?:value|price|amount)|order value)[^0-9₹\n]{0,20}(?:₹|Rs\.?|INR)?\s*([\d,]{3,}(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr)?/i);
        if (w && !got) out.push({ bid: h.id, org: org, item: item, rank: 1, bidder: clean(w[1], 120), price: p ? money(p[1], p[2]) : "", awarded: "yes", resultDate: date, source: "Email result" });
        else if (!got && p) out.push({ bid: h.id, org: org, item: item, rank: 1, bidder: "", price: money(p[1], p[2]), awarded: "", resultDate: date, source: "Email result" });
      });
    });
  });
  return out;
}

/* ---- GeM direct: public "All bids" search, one page per keyword ---- */
function gemFetch(kws) {
  var st = { at: new Date().toISOString(), ok: false, n: 0, err: "" }, out = [], seen = {};
  try {
    var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
    var home = UrlFetchApp.fetch("https://bidplus.gem.gov.in/all-bids", { muteHttpExceptions: true, followRedirects: true, headers: { "User-Agent": UA } });
    if (home.getResponseCode() >= 400) throw "GeM page answered " + home.getResponseCode();
    var h = home.getAllHeaders(), sc = h["Set-Cookie"] || h["set-cookie"] || []; if (!Array.isArray(sc)) sc = [sc];
    var cookies = sc.map(function (c) { return String(c).split(";")[0]; }).join("; "), html = home.getContentText();
    var csrf = (cookies.match(/csrf_gem_cookie=([^;]+)/) || [])[1] || (html.match(/name=["']csrf_bd_gem_nk["'][^>]*value=["']([^"']+)/i) || [])[1] || (html.match(/csrf_bd_gem_nk["']?\s*[:=,]\s*["']([A-Za-z0-9]{16,})/) || [])[1];
    if (!csrf) throw "GeM security token not found (site changed?)";
    (kws || []).slice(0, 15).forEach(function (kw) {
      var payload = { page: 1, param: { searchBid: kw, searchType: "fullText" }, filter: { bidStatusType: "ongoing_bids", byType: "all", highBidValue: "", byEndDate: { from: "", to: "" }, sort: "Bid-End-Date-Latest" } };
      var r = UrlFetchApp.fetch("https://bidplus.gem.gov.in/all-bids-data", { method: "post", muteHttpExceptions: true, payload: { payload: JSON.stringify(payload), csrf_bd_gem_nk: csrf },
        headers: { "User-Agent": UA, "Cookie": cookies, "X-Requested-With": "XMLHttpRequest", "Referer": "https://bidplus.gem.gov.in/all-bids" } });
      if (r.getResponseCode() >= 400) throw "GeM search answered " + r.getResponseCode();
      var j = JSON.parse(r.getContentText() || "{}"), docs = (((j.response || {}).response || {}).docs) || [];
      var f = function (d, k) { var v = d[k]; return Array.isArray(v) ? v[0] : v; };
      docs.forEach(function (d) {
        var bid = f(d, "b_bid_number") || f(d, "bid_number"); if (!bid || seen[bid]) return; seen[bid] = 1;
        var item = f(d, "b_category_name") || f(d, "bd_category_name") || f(d, "b_items") || kw, org = [f(d, "ba_official_details_minName"), f(d, "ba_official_details_deptName")].filter(Boolean).join(" / ");
        var id = f(d, "b_id") || f(d, "id"), qty = f(d, "b_total_quantity");
        out.push({ bid: bid, portal: "GeM", org: org, item: item + (qty ? " · Qty " + qty : ""), published: String(f(d, "final_start_date_sort") || "").slice(0, 10), closing: String(f(d, "final_end_date_sort") || "").slice(0, 10),
          link: id ? "https://bidplus.gem.gov.in/showbidDocument/" + id : "https://bidplus.gem.gov.in/all-bids", fit: fitOf(item + " " + org + " " + kw, kws), subject: "GeM search: " + kw });
      });
      Utilities.sleep(400);
    });
    st.ok = true; st.n = out.length;
  } catch (e) { st.err = String(e && e.message || e).slice(0, 200); }
  props().setProperty("GEM_STATUS", JSON.stringify(st));
  return out;
}
function tdbSyncRegister() {
  var reg = getBlob("register") || { data: {} }, ts = (reg.data && reg.data.tenders) || [], res = [];
  tdbUpsert(ts.map(function (t) { return { bid: t.bid, portal: t.portal, org: t.org, item: t.items, value: t.value, emd: t.emdAmount, published: t.published, closing: t.closing, preBid: t.preBid, fit: 100, link: t.link }; }), "Rivera register");
  ts.forEach(function (t) {
    var r = t.result || {}, d = r.date || t.closing || "";
    if (t.ourPrice) res.push({ bid: t.bid, org: t.org, item: t.items, bidder: "Rivera Coil Manufacturing", rank: r.rank || "", price: t.ourPrice, awarded: t.status === "awarded" ? "yes" : (t.status === "not_awarded" ? "no" : ""), resultDate: d, source: "Rivera register" });
    if (r.l1 && Number(r.rank) !== 1) res.push({ bid: t.bid, org: t.org, item: t.items, bidder: r.winner || "", rank: 1, price: r.l1, awarded: "", resultDate: d, source: "Rivera register" });
  });
  trUpsert(res, "automation");
}
function tdbWatch(alerts) {
  var P = props(), out = { email: 0, gem: 0, results: 0 }, gem = [];
  try { out.email = tdbUpsert((alerts || []).map(alertToRow), "Email alert").added; } catch (e) { log("automation", "tdb-email-error", String(e)); }
  try { var rr = resultsFromThreads(GmailApp.search(RESULT_Q + "newer_than:20d", 0, 60)); out.results = trUpsert(rr, "automation").added; } catch (e) { log("automation", "tdb-result-error", String(e)); }
  try { var gs = gemSweep(90000); out.gem = (gs && gs.kept) || 0; } catch (e) { log("automation", "tdb-gem-error", String(e)); }
  try { tdbSyncRegister(); } catch (e) { log("automation", "tdb-register-error", String(e)); }
  P.setProperty("TDB_LAST", JSON.stringify({ at: new Date().toISOString(), email: out.email, gem: out.gem, results: out.results }));
  out.gemAlerts = gem.map(function (g) { return { bid: g.bid, portal: "GeM", org: g.org, item: g.item, subject: g.subject, closing: g.closing, fit: g.fit, link: g.link, emd: 0, value: 0, date: new Date().toISOString() }; });
  return out;
}

/* ---- one-time backfill of old mails (3 years), resumes every 10 minutes until finished ---- */
function tdbBackfill() {
  var P = props(), pos = Number(P.getProperty("TDB_BF_POS") || 0), rpos = Number(P.getProperty("TDB_BF_RPOS") || 0), n = Number(P.getProperty("TDB_BF_N") || 0), t0 = Date.now(), kw = kwList(), done = false;
  while (Date.now() - t0 < 270000) {
    var th = GmailApp.search(TDB_Q_ALL, pos, 40);
    if (th.length) { var al = alertsFromThreads(th, kw); tdbUpsert(al.map(alertToRow), "Email (old)"); n += al.length; pos += th.length; P.setProperty("TDB_BF_POS", String(pos)); P.setProperty("TDB_BF_N", String(n)); continue; }
    var th2 = GmailApp.search(RESULT_Q + "newer_than:1100d", rpos, 40);
    if (th2.length) { trUpsert(resultsFromThreads(th2), "backfill"); rpos += th2.length; P.setProperty("TDB_BF_RPOS", String(rpos)); continue; }
    done = true; break;
  }
  if (done) { P.setProperty("TDB_BF_DONE", new Date().toISOString()); tdbBackfillStop(); }
  log("automation", "tdb-backfill", pos + " alert threads, " + rpos + " result threads, " + n + " tenders" + (done ? " — finished" : ""));
  return tdbBackfillState();
}
function tdbBackfillStart() {
  var P = props(); ["TDB_BF_POS", "TDB_BF_RPOS", "TDB_BF_N", "TDB_BF_DONE"].forEach(function (k) { P.deleteProperty(k); });
  tdbBackfillStop(); ScriptApp.newTrigger("tdbBackfill").timeBased().everyMinutes(10).create(); P.setProperty("TDB_BF_START", new Date().toISOString());
}
function tdbBackfillStop() { ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "tdbBackfill") ScriptApp.deleteTrigger(t); }); }
function tdbBackfillState() {
  var P = props(), on = false; try { on = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "tdbBackfill"; }); } catch (e) { }
  return { on: on, started: P.getProperty("TDB_BF_START") || "", done: P.getProperty("TDB_BF_DONE") || "", threads: Number(P.getProperty("TDB_BF_POS") || 0), resultThreads: Number(P.getProperty("TDB_BF_RPOS") || 0), tenders: Number(P.getProperty("TDB_BF_N") || 0) };
}

/* ---- queries for the app ---- */
function tdbAll() { return readTable(tdbSheet(), TDH); }
function trAll() { return readTable(trSheet(), TRH); }
function regIndex() { var reg = getBlob("register") || { data: {} }, m = {}; ((reg.data && reg.data.tenders) || []).forEach(function (t) { m[tkey(t.bid)] = { status: t.status, id: t.id }; }); return m; }
function resIndex(R) { var m = {}; R.forEach(function (r) { var k = tkey(r.bid), b = m[k] = m[k] || { n: 0, l1: null, winner: "", rivera: null }; b.n++; var p = Number(r.price) || 0; if (Number(r.rank) === 1 || (p && (!b.l1 || p < b.l1.price))) { if (!b.l1 || Number(r.rank) === 1 || p < b.l1.price) b.l1 = { bidder: r.bidder, price: p }; } if (r.awarded === "yes") b.winner = r.bidder; if (/rivera/i.test(r.bidder)) b.rivera = { price: p, rank: r.rank }; }); return m; }
function tdbQuery(d) {
  var today = todayIST(), all = tdbAll(), q = String(d.q || "").toLowerCase().trim(), words = q ? q.split(/\s+/) : [], R = trAll(), ri = resIndex(R), reg = regIndex();
  var counts = { all: all.length, live: 0, closed: 0, results: R.length, resultTenders: Object.keys(ri).length };
  all.forEach(function (r) { r.status = tstatus(r, today); if (r.status === "live") counts.live++; else counts.closed++; });
  var L = all.filter(function (r) {
    if (d.status && d.status !== "all" && r.status !== d.status) return false;
    if (d.portal && r.portal !== d.portal) return false;
    if (d.state && r.state !== d.state) return false;
    if (d.org && String(r.org).toLowerCase().indexOf(String(d.org).toLowerCase()) < 0) return false;
    if (d.from && (!r.closing || r.closing < d.from)) return false;
    if (d.to && (!r.closing || r.closing > d.to)) return false;
    if (d.vmin && Number(r.value || 0) < Number(d.vmin)) return false;
    if (d.vmax && r.value && Number(r.value) > Number(d.vmax)) return false;
    if (d.fit && Number(r.fit || 0) < Number(d.fit)) return false;
    if (d.hasResult && !ri[r.key]) return false;
    if (words.length) { var s = (r.bid + " " + r.org + " " + r.item + " " + r.state + " " + r.city + " " + r.portal + " " + r.subject).toLowerCase(); for (var i = 0; i < words.length; i++) if (s.indexOf(words[i]) < 0) return false; }
    return true;
  });
  var sort = d.sort || (d.status === "live" ? "closing" : "recent");
  L.sort(function (a, b) {
    if (sort === "closing") return String(a.closing || "9999").localeCompare(String(b.closing || "9999"));
    if (sort === "value") return Number(b.value || 0) - Number(a.value || 0);
    if (sort === "fit") return Number(b.fit || 0) - Number(a.fit || 0) || String(b.closing).localeCompare(String(a.closing));
    return String(b.closing || b.published || "").localeCompare(String(a.closing || a.published || ""));
  });
  var facet = function (k) { var m = {}; L.forEach(function (r) { if (r[k]) m[r[k]] = (m[r[k]] || 0) + 1; }); return Object.keys(m).map(function (x) { return [x, m[x]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 60); };
  var size = Math.min(Number(d.size) || 50, 5000), page = Math.max(1, Number(d.page) || 1), rows = L.slice((page - 1) * size, page * size).map(function (r) { r.result = ri[r.key] || null; r.tracked = reg[r.key] || null; return r; });
  var byYear = {}; L.forEach(function (r) { var y = String(r.closing || r.published || "").slice(0, 4); if (y) byYear[y] = (byYear[y] || 0) + 1; });
  return { ok: true, rows: rows, total: L.length, page: page, size: size, counts: counts, facets: { portal: facet("portal"), state: facet("state") }, byYear: byYear, allPortals: Object.keys(all.reduce(function (m, r) { if (r.portal) m[r.portal] = 1; return m; }, {})).sort() };
}
function trQuery(d) {
  var R = trAll(), q = String(d.q || "").toLowerCase().trim(), words = q ? q.split(/\s+/) : [], T = {};
  tdbAll().forEach(function (t) { T[t.key] = t; });
  var L = R.filter(function (r) {
    if (d.bid && tkey(r.bid) !== tkey(d.bid)) return false;
    if (d.bidder && nkey(r.bidder) !== nkey(d.bidder)) return false;
    if (words.length) { var t = T[tkey(r.bid)] || {}, s = (r.bid + " " + r.org + " " + r.item + " " + r.bidder + " " + (t.org || "") + " " + (t.item || "")).toLowerCase(); for (var i = 0; i < words.length; i++) if (s.indexOf(words[i]) < 0) return false; }
    return true;
  }).map(function (r) { var t = T[tkey(r.bid)] || {}; if (!r.org) r.org = t.org || ""; if (!r.item) r.item = t.item || ""; r.closing = t.closing || ""; r.link = t.link || ""; return r; });
  L.sort(function (a, b) { return String(b.resultDate || b.closing).localeCompare(String(a.resultDate || a.closing)) || tkey(a.bid).localeCompare(tkey(b.bid)) || (Number(a.rank) || 99) - (Number(b.rank) || 99); });
  var size = Math.min(Number(d.size) || 100, 5000), page = Math.max(1, Number(d.page) || 1);
  return { ok: true, rows: L.slice((page - 1) * size, page * size), total: L.length, page: page, size: size };
}
function tdbStats() {
  var today = todayIST(), all = tdbAll(), R = trAll(), reg = getBlob("register") || { data: {} }, ts = (reg.data && reg.data.tenders) || [], rt = {};
  ts.forEach(function (t) { rt[tkey(t.bid)] = t; });
  var B = {};
  all.forEach(function (r) {
    var o = String(r.org || "").trim() || "(buyer not given)", b = B[o] = B[o] || { org: o, n: 0, live: 0, value: 0, last: "", first: "", portals: {}, states: {}, tracked: 0, won: 0, items: {} };
    b.n++; if (tstatus(r, today) === "live") b.live++; b.value += Number(r.value) || 0; var dt = r.closing || r.published || ""; if (dt > b.last) b.last = dt; if (dt && (!b.first || dt < b.first)) b.first = dt;
    if (r.portal) b.portals[r.portal] = 1; if (r.state) b.states[r.state] = 1; var t = rt[r.key]; if (t) { b.tracked++; if (t.status === "awarded") b.won++; }
    var it = String(r.item || "").split(/[,;(·]/)[0].trim().slice(0, 50); if (it) b.items[it] = (b.items[it] || 0) + 1;
  });
  var buyers = Object.keys(B).map(function (k) { var b = B[k]; b.portals = Object.keys(b.portals); b.states = Object.keys(b.states); b.items = Object.keys(b.items).sort(function (x, y) { return b.items[y] - b.items[x]; }).slice(0, 4); return b; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 400);
  var byBid = {}; R.forEach(function (r) { (byBid[tkey(r.bid)] = byBid[tkey(r.bid)] || []).push(r); });
  var C = {};
  Object.keys(byBid).forEach(function (k) {
    var rs = byBid[k], riv = rs.filter(function (r) { return /rivera/i.test(r.bidder); })[0], rp = riv ? Number(riv.price) || 0 : 0;
    rs.forEach(function (r) {
      if (!r.bidder || /rivera/i.test(r.bidder)) return;
      var key = nkey(r.bidder), c = C[key] = C[key] || { name: r.bidder, bids: 0, l1: 0, won: 0, prices: 0, pn: 0, vsRivera: 0, beatRivera: 0, gaps: [], last: "", items: {}, buyers: {} };
      c.bids++; if (Number(r.rank) === 1) c.l1++; if (r.awarded === "yes") c.won++; var p = Number(r.price) || 0; if (p) { c.prices += p; c.pn++; }
      if (rp && p) { c.vsRivera++; if (p < rp) c.beatRivera++; c.gaps.push((rp - p) / p * 100); }
      var dt = r.resultDate || ""; if (dt > c.last) c.last = dt; if (r.item) c.items[String(r.item).split(/[,;(]/)[0].slice(0, 40)] = 1; if (r.org) c.buyers[r.org] = 1;
    });
  });
  var comps = Object.keys(C).map(function (k) { var c = C[k]; c.avgGap = c.gaps.length ? c.gaps.reduce(function (a, b) { return a + b; }, 0) / c.gaps.length : null; c.avgPrice = c.pn ? c.prices / c.pn : 0; c.items = Object.keys(c.items).slice(0, 4); c.buyers = Object.keys(c.buyers).slice(0, 4); delete c.gaps; delete c.prices; return c; }).sort(function (a, b) { return b.bids - a.bids; }).slice(0, 400);
  var riv = R.filter(function (r) { return /rivera/i.test(r.bidder); });
  return { ok: true, buyers: buyers, competitors: comps, rivera: { bids: riv.length, l1: riv.filter(function (r) { return Number(r.rank) === 1; }).length, won: riv.filter(function (r) { return r.awarded === "yes"; }).length } };
}
function tdbState() {
  var P = props(), g = {}, l = {}; try { g = JSON.parse(P.getProperty("GEM_STATUS") || "{}"); } catch (e) { } try { l = JSON.parse(P.getProperty("TDB_LAST") || "{}"); } catch (e) { }
  var n = 0, r = 0; try { n = Math.max(0, tdbSheet().getLastRow() - 1); r = Math.max(0, trSheet().getLastRow() - 1); } catch (e) { }
  return { ok: true, tenders: n, results: r, gem: g, gemOn: cfg("gemDirect", "1") === "1", last: l, backfill: tdbBackfillState(), auto: automationState(), sheet: ss().getUrl(), sweep: gemSweepState(), kw: kwList().length };
}

/* ================= GeM full sweep — every GeM bid for every Rivera keyword, nothing missed =================
 * Source 1: bidplus.gem.gov.in "All bids" search — every result page for every keyword.
 * Source 2: CPPP's public list of all active GeM bids (eprocure.gov.in/cppp/latestactivetendersnew/gemdata, ~3,500 pages)
 *           — every page is read and every bid that matches a Rivera keyword is kept.
 * Runs in slices of ~4.5 minutes (trigger every 15 min) and starts a fresh sweep every 3 hours.
 * Matches go to TenderDB; strong matches (75%+) are also added to the Rivera tender register like email alerts.
 */
var SITE = "https://riverasalesindia-del.github.io/rivera-quote-studio/";
var LINKS = { site: SITE, admin: SITE + "admin.html", apk: "https://github.com/riverasalesindia-del/rivera-quote-studio/releases/latest/download/RiveraQuoteStudio.apk", win: "https://github.com/riverasalesindia-del/rivera-quote-studio/releases/latest/download/RiveraQuoteStudio-Setup.exe" };
var CPPP_GEM = "https://eprocure.gov.in/cppp/latestactivetendersnew/gemdata";
var GEM_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
var MON3 = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function isoAny(s) {
  s = String(s || ""); var m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  m = s.match(/(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/, ]+(\d{4})/); if (m && MON3[m[2].toLowerCase()]) return m[3] + "-" + ("0" + MON3[m[2].toLowerCase()]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  m = s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/); if (m) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  return "";
}
function gemSession() {
  var home = UrlFetchApp.fetch("https://bidplus.gem.gov.in/all-bids", { muteHttpExceptions: true, followRedirects: true, headers: { "User-Agent": GEM_UA } });
  if (home.getResponseCode() >= 400) throw "GeM page answered " + home.getResponseCode();
  var h = home.getAllHeaders(), sc = h["Set-Cookie"] || h["set-cookie"] || []; if (!Array.isArray(sc)) sc = [sc];
  var cookies = sc.map(function (c) { return String(c).split(";")[0]; }).join("; "), html = home.getContentText();
  var csrf = (cookies.match(/csrf_gem_cookie=([^;]+)/) || [])[1] || (html.match(/name=["']csrf_bd_gem_nk["'][^>]*value=["']([^"']+)/i) || [])[1] || (html.match(/csrf_bd_gem_nk["']?\s*[:=,]\s*["']([A-Za-z0-9]{16,})/) || [])[1];
  if (!csrf) throw "GeM security token not found (site changed?)";
  return { cookies: cookies, csrf: csrf };
}
function gemPage(sess, kw, page, kws) {
  var payload = { page: page, param: { searchBid: kw, searchType: "fullText" }, filter: { bidStatusType: "ongoing_bids", byType: "all", highBidValue: "", byEndDate: { from: "", to: "" }, sort: "Bid-End-Date-Latest" } };
  var r = UrlFetchApp.fetch("https://bidplus.gem.gov.in/all-bids-data", { method: "post", muteHttpExceptions: true, payload: { payload: JSON.stringify(payload), csrf_bd_gem_nk: sess.csrf },
    headers: { "User-Agent": GEM_UA, "Cookie": sess.cookies, "X-Requested-With": "XMLHttpRequest", "Referer": "https://bidplus.gem.gov.in/all-bids" } });
  if (r.getResponseCode() >= 400) throw "GeM search answered " + r.getResponseCode();
  var j = JSON.parse(r.getContentText() || "{}"), resp = (j.response || {}).response || {}, docs = resp.docs || [];
  var f = function (d, k) { var v = d[k]; return Array.isArray(v) ? v[0] : v; };
  return { numFound: Number(resp.numFound || 0), rows: docs.map(function (d) {
    var bid = f(d, "b_bid_number") || f(d, "bid_number"), item = f(d, "b_category_name") || f(d, "bd_category_name") || f(d, "b_items") || kw, org = [f(d, "ba_official_details_minName"), f(d, "ba_official_details_deptName")].filter(Boolean).join(" / ");
    var id = f(d, "b_id") || f(d, "id"), qty = f(d, "b_total_quantity");
    return { bid: bid, portal: "GeM", org: org, item: item + (qty ? " · Qty " + qty : ""), published: String(f(d, "final_start_date_sort") || "").slice(0, 10), closing: String(f(d, "final_end_date_sort") || "").slice(0, 10),
      link: id ? "https://bidplus.gem.gov.in/showbidDocument/" + id : "https://bidplus.gem.gov.in/all-bids", fit: fitOf(item + " " + org + " " + kw, kws), subject: "GeM search: " + kw };
  }).filter(function (x) { return x.bid; }) };
}
function cpppParse(html) {
  var out = [], total = Number(((String(html).match(/Total\s*Bid\(s\)\s*:?\s*([\d,]+)/i) || [])[1] || "0").replace(/,/g, ""));
  var dec = function (s) { return String(s).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim(); };
  (String(html).match(/<tr[\s\S]*?<\/tr>/gi) || []).forEach(function (tr) {
    var tds = tr.match(/<td[\s\S]*?<\/td>/gi); if (!tds || tds.length < 6) return;
    var t = tds.map(dec), bid = (t.join(" ").match(/GEM\/\d{4}\/[BR]\/\d{4,}/) || [])[0]; if (!bid) return;
    var bi = 0; for (var i = 0; i < t.length; i++) if (t[i].indexOf(bid) >= 0) { bi = i; break; }
    var dates = t.filter(function (x) { return isoAny(x); }), qty = (t[bi].replace(bid, "").match(/\d[\d,]*/) || [""])[0];
    var href = (tr.match(/href=["']([^"']*gemtendersfullview[^"']*)["']/i) || tr.match(/href=["']([^"']+)["']/i) || [])[1] || "";
    out.push({ bid: bid, portal: "GeM", published: isoAny(dates[0]), closing: isoAny(dates[1] || dates[0]), item: (t[bi + 1] || "") + (qty ? " · Qty " + qty : ""),
      org: [t[bi + 2], t[bi + 3]].filter(Boolean).join(" / "), link: href ? (/^https?:/.test(href) ? href : "https://eprocure.gov.in" + (href.charAt(0) === "/" ? "" : "/") + href) : "https://bidplus.gem.gov.in/all-bids", subject: "CPPP GeM bids list" });
  });
  return { rows: out, total: total };
}
function kwHit(text, kws) { var t = String(text || "").toLowerCase(); return kws.some(function (w) { return w && t.indexOf(String(w).toLowerCase()) >= 0; }); }
function gemSweepState() { try { return JSON.parse(props().getProperty("GEM_SWEEP") || "{}"); } catch (e) { return {}; } }
function gemSweepJob() { return gemSweep(270000); }
function gemSweep(budget, fresh) {
  var P = props(), busy = Number(P.getProperty("GEM_SWEEP_BUSY") || 0);
  if (busy && Date.now() - busy < 6 * 6e4) return { busy: true, state: gemSweepState() };
  if (cfg("gemDirect", "1") !== "1") return { off: true };
  P.setProperty("GEM_SWEEP_BUSY", String(Date.now()));
  var t0 = Date.now(), s = gemSweepState(), kws = kwList(), kept = [], strong = [];
  try {
    budget = budget || 270000;
    if (fresh || !s.started || (s.done && Date.now() - new Date(s.done).getTime() > 3 * 36e5)) s = { started: new Date().toISOString(), ki: 0, page: 1, cp: 1, cpTotal: 0, cpFirst: "", gemSeen: 0, cpSeen: 0, matched: 0, added: 0, gemErr: "", cpErr: "", perKw: {} };
    if (s.done) return { state: s, idle: true };
    // 1) GeM search: every page for every keyword
    if (!s.gemDoneAt) {
      try {
        var sess = gemSession();
        while (Date.now() - t0 < budget * 0.45 && s.ki < kws.length) {
          var kw = kws[s.ki], r = gemPage(sess, kw, s.page, kws);
          s.perKw[kw] = r.numFound; s.gemSeen += r.rows.length;
          r.rows.forEach(function (x) { kept.push(x); });
          if (!r.rows.length || s.page * 10 >= r.numFound || s.page >= 300) { s.ki++; s.page = 1; } else s.page++;
          Utilities.sleep(250);
        }
        if (s.ki >= kws.length) s.gemDoneAt = new Date().toISOString();
      } catch (e) { s.gemErr = String(e && e.message || e).slice(0, 160); s.gemDoneAt = new Date().toISOString(); }
    }
    // 2) CPPP list of every active GeM bid: all pages, 8 at a time
    while (!s.cpDoneAt && Date.now() - t0 < budget) {
      try {
        var nums = []; for (var i = 0; i < 8; i++) nums.push(s.cp + i);
        var res = UrlFetchApp.fetchAll(nums.map(function (n) { return { url: CPPP_GEM + "?page=" + n, muteHttpExceptions: true, followRedirects: true, headers: { "User-Agent": GEM_UA } }; }));
        var any = false;
        res.forEach(function (resp, k) {
          if (resp.getResponseCode() >= 400) throw "CPPP answered " + resp.getResponseCode();
          var p = cpppParse(resp.getContentText()); if (p.total) s.cpTotal = p.total;
          if (!p.rows.length) return; any = true;
          if (nums[k] === 1) s.cpFirst = p.rows[0].bid; else if (s.cpFirst && p.rows[0].bid === s.cpFirst) throw "CPPP ignored the page number";
          s.cpSeen += p.rows.length;
          p.rows.forEach(function (x) { if (!kwHit(x.item, kws)) return; x.fit = fitOf(x.item + " " + x.org, kws); kept.push(x); });
        });
        s.cp += nums.length;
        if (!any || (s.cpTotal && (s.cp - 1) * 10 >= s.cpTotal) || s.cp > 8000) s.cpDoneAt = new Date().toISOString();
      } catch (e) { s.cpErr = String(e && e.message || e).slice(0, 160); s.cpDoneAt = new Date().toISOString(); }
    }
    if (kept.length) {
      var u = tdbUpsert(kept, "GeM portal"); s.added += u.added; s.matched += kept.filter(function (x) { return x.fit > 0; }).length;
      strong = kept.filter(function (x) { return x.fit >= 75 && x.closing && x.closing >= todayIST(); });
      if (strong.length) try { applyAlerts(strong.map(function (g) { return { bid: g.bid, portal: "GeM", org: g.org, item: g.item, subject: g.subject, closing: g.closing, fit: g.fit, link: g.link, emd: 0, value: 0, date: new Date().toISOString() }; })); } catch (e) { log("automation", "gem-sweep-register-error", String(e)); }
    }
    if (s.gemDoneAt && s.cpDoneAt) { s.done = new Date().toISOString(); log("automation", "gem-sweep", "GeM search " + s.gemSeen + " bids, CPPP list " + s.cpSeen + " bids, " + s.added + " new for Rivera" + (s.gemErr ? " · GeM: " + s.gemErr : "") + (s.cpErr ? " · CPPP: " + s.cpErr : "")); }
    P.setProperty("GEM_STATUS", JSON.stringify({ at: new Date().toISOString(), ok: !(s.gemErr && s.cpErr), n: s.gemSeen + s.cpSeen, err: [s.gemErr && "GeM search: " + s.gemErr, s.cpErr && "CPPP list: " + s.cpErr].filter(Boolean).join(" · ") }));
    return { state: s, kept: kept.length };
  } finally {
    P.setProperty("GEM_SWEEP", JSON.stringify(s)); P.deleteProperty("GEM_SWEEP_BUSY");
  }
}
function gemSweepInstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "gemSweepJob") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("gemSweepJob").timeBased().everyMinutes(15).create();
}

/* ---- team logins: role list, first-sign-in password change, login mail ---- */
var ROLES = ["admin", "sales", "finance", "operation", "viewer"];
var ROLE_NAME = { admin: "Admin", sales: "Sales", finance: "Finance", operation: "Operations", viewer: "View only" };
function loginMailHtml(u, pw) {
  return "<p>Hello " + esc(u.name) + ",</p><p>Your login for <b>" + APP + "</b> is ready. Role: <b>" + esc(ROLE_NAME[u.role] || u.role) + "</b>.</p>" +
    '<table style="border-collapse:collapse;font-size:15px;margin:8px 0"><tr><td style="padding:6px 12px 6px 0;color:#555">Username</td><td style="padding:6px 0"><b>' + esc(u.email) + '</b></td></tr><tr><td style="padding:6px 12px 6px 0;color:#555">Temporary password</td><td style="padding:6px 0;font-family:monospace;font-size:16px"><b>' + esc(pw) + "</b></td></tr></table>" +
    "<p>You will be asked to set your own password the first time you sign in. The admin (" + ADMIN + ") approves each new device once.</p>" +
    "<p>" + btn(LINKS.site, "Sign in on the website", "#02315B") + btn(LINKS.apk, "Android app", "#F26A10") + btn(LINKS.win, "Windows app", "#555555") + "</p>" +
    '<p style="color:#888;font-size:12px">Website: ' + LINKS.site + "<br>Keep this password private. If you did not expect this mail, tell " + ADMIN + ".</p>";
}
function roleDigests(sec) {
  var v = users().getDataRange().getValues(), sent = [];
  for (var i = 1; i < v.length; i++) {
    var u = {}; UH.forEach(function (k, j) { u[k] = v[i][j]; });
    if (u.status !== "approved" || !/@/.test(u.email) || u.email === digestTo() || ["sales", "finance", "operation"].indexOf(u.role) < 0) continue;
    var parts = u.role === "finance" ? [sec.emdPay, sec.refund, sec.pbg] : u.role === "operation" ? [sec.awarded, sec.pbg, sec.closing] : [sec.gemNew, sec.fresh, sec.closing, sec.ra, sec.pre];
    var body = parts.join("");
    if (!body) body = "<p>Nothing needs your attention today.</p>";
    mail(u.email, APP + " — " + (ROLE_NAME[u.role] || u.role) + " summary " + dmyS(todayIST()), "<p>Good morning " + esc(u.name) + ". Here is today's " + esc(ROLE_NAME[u.role]).toLowerCase() + " summary.</p>" + body + '<p style="margin-top:16px">' + btn(LINKS.site, "Open " + APP, "#02315B") + "</p>");
    sent.push(u.email);
  }
  return sent;
}
function gemNewHtml() {
  var since = new Date(Date.now() - 26 * 36e5).toISOString(), today = todayIST();
  var L = tdbAll().filter(function (r) { return String(r.firstSeen) >= since && Number(r.fit) >= 50 && (!r.closing || r.closing >= today); }).sort(function (a, b) { return Number(b.fit) - Number(a.fit); }).slice(0, 60);
  return tableHtml("New Rivera matches in the tender database (last 24 h)", ["Bid / tender", "Portal", "Buyer", "Item", "Closing", "Match"], L.map(function (r) { return rowHtml([r.link ? '<a href="' + esc(r.link) + '">' + esc(r.bid) + "</a>" : esc(r.bid), esc(r.portal), esc(r.org), esc(String(r.item).slice(0, 120)), dmyS(r.closing), r.fit + "%"]); }));
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
  if (a === "firstPassword") { if (String(me.mustChange || "") !== "1") throw "Use Change password in My account"; if (String(d.pw || "").length < 40) throw "Password not accepted"; me.salt = Utilities.getUuid(); me.hash = hashPw(d.pw, me.salt); me.mustChange = ""; saveUser(me); log(me.email, "password-first-set", ""); return { ok: true, user: pub(me) }; }
  if (a === "links") return { ok: true, links: LINKS };
  if (a === "password") { me.mustChange = ""; if (!eq(hashPw(String(d.old || ""), me.salt), me.hash)) throw "Current password is wrong"; if (String(d.pw || "").length < 40) throw "Password not accepted"; me.salt = Utilities.getUuid(); me.hash = hashPw(d.pw, me.salt); saveUser(me); log(me.email, "password-change", ""); return { ok: true }; }
  /* ---- tender database (all signed-in users) ---- */
  if (a === "tdbQuery") return tdbQuery(d);
  if (a === "trQuery") return trQuery(d);
  if (a === "tdbStats") return tdbStats();
  if (a === "tdbState") { var st3 = tdbState(); if (me.role !== "admin") delete st3.sheet; return st3; }
  if (a === "tdbImport") {
    var rows3 = Array.isArray(d.rows) ? d.rows.slice(0, 3000) : [];
    var r3 = d.kind === "results" ? trUpsert(rows3.map(function (x) { x.source = "Excel import"; return x; }), me.email) : tdbUpsert(rows3, "Excel import" + (d.label ? " (" + String(d.label).slice(0, 30) + ")" : ""));
    log(me.email, "tdb-import", (d.kind || "tenders") + ": " + rows3.length + " rows, " + r3.added + " new"); return { ok: true, result: r3 };
  }
  if (a === "tdbResultSave") { var rr3 = (Array.isArray(d.rows) ? d.rows : [d.row]).filter(Boolean).slice(0, 60).map(function (x) { x.source = x.source || "Manual"; return x; }); var o3 = trUpsert(rr3, me.email); log(me.email, "tdb-result", rr3.length + " rows for " + (rr3[0] && rr3[0].bid)); return { ok: true, result: o3 }; }
  if (a === "tdbResultDel") {
    var lk = LockService.getScriptLock(); lk.waitLock(20000);
    try { var sh3 = trSheet(), all3 = readTable(sh3, TRH), x3 = all3.filter(function (r) { return r.key === d.key; })[0]; if (!x3) return { ok: true }; if (me.role !== "admin" && x3.by !== me.email) throw "Only the person who added it (or an admin) can delete it"; writeTable(sh3, TRH, all3.filter(function (r) { return r.key !== d.key; })); log(me.email, "tdb-result-delete", d.key); return { ok: true }; }
    finally { lk.releaseLock(); }
  }
  if (a === "tdbRun") {
    if (d.op === "gem") { props().deleteProperty("GEM_SWEEP_BUSY"); var g3 = gemSweep(240000, !!d.fresh); log(me.email, "tdb-gem", JSON.stringify((g3 && g3.state) || {}).slice(0, 200)); return { ok: true, found: (g3 && g3.kept) || 0, sweep: g3 && g3.state, state: tdbState() }; }
    var w3 = hourlyWatch(); return { ok: true, result: w3, state: tdbState() };
  }
  /* ---- admin ---- */
  auth(d.token, true);
  if (a === "mailLogin") { var mu = findUser(cleanEmail(d.email)); if (!mu) throw "No such user"; var to = /@/.test(mu.email) ? mu.email : mu.contact; if (!/@/.test(String(to || ""))) throw "This login has no email address"; if (String(d.pw || "").length < 8) throw "No password to send"; mail(to, APP + " — your login", loginMailHtml(mu, String(d.pw))); log(me.email, "login-mailed", mu.email + " → " + to); return { ok: true, to: to }; }
  if (a === "tdbBackfill") { if (d.op === "start") { tdbBackfillStart(); log(me.email, "tdb-backfill-start", ""); } if (d.op === "stop") tdbBackfillStop(); if (d.op === "now") tdbBackfill(); return { ok: true, state: tdbState() }; }
  if (a === "tdbConfig") { if (d.gemDirect !== undefined) props().setProperty("CFG_gemDirect", d.gemDirect ? "1" : "0"); return { ok: true, state: tdbState() }; }

  if (a === "users") { var v = users().getDataRange().getValues(), out = []; for (var i = 1; i < v.length; i++) { var x = {}; UH.forEach(function (k, j) { x[k] = v[i][j]; }); if (x.email) out.push(pub(x)); } return { ok: true, users: out }; }
  if (a === "createUser") {
    var nid = cleanId(d.email), nn = String(d.name || "").trim().slice(0, 80); if (!nn) throw "Enter the person's name"; if (String(d.pw || "").length < 40) throw "Password not accepted";
    if (findUser(nid)) throw "That username already exists";
    var role = ROLES.indexOf(d.role) >= 0 ? d.role : "sales";
    var nu = { email: nid, name: nn, contact: String(d.contact || "").trim().slice(0, 120), role: role, status: "approved", created: new Date(), fails: 0, approvedBy: me.email, salt: Utilities.getUuid(), mustChange: d.keepPw ? "" : "1" }; nu.hash = hashPw(d.pw, nu.salt);
    saveUser(nu); log(me.email, "create-user", nid + " " + role); return { ok: true, user: pub(nu) };
  }
  if (a === "setUser") {
    var tu = findUser(cleanEmail(d.email)); if (!tu) throw "No such user";
    if (tu.email === ADMIN && (d.status && d.status !== "approved" || d.role && d.role !== "admin")) throw "The main admin account can't be changed";
    if (d.status) { if (["approved", "revoked"].indexOf(d.status) < 0) throw "Bad status"; tu.status = d.status; if (d.status === "approved") tu.approvedBy = me.email; }
    if (d.role) { if (ROLES.indexOf(d.role) < 0) throw "Bad role"; tu.role = d.role; }
    if (d.name) tu.name = String(d.name).trim().slice(0, 80);
    if (d.contact !== undefined) tu.contact = String(d.contact || "").trim().slice(0, 120);
    if (d.pw) { if (String(d.pw).length < 40) throw "Password not accepted"; tu.salt = Utilities.getUuid(); tu.hash = hashPw(d.pw, tu.salt); tu.fails = 0; tu.lockUntil = ""; tu.mustChange = d.keepPw ? "" : "1"; }
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
