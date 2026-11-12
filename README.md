# Rivera Quote Studio

Sales quotation tool for Rivera Coil Manufacturing (I) Pvt Ltd: scan enquiries and vendor quotations, build QUOTE WORKINGS, issue quotations with terms, compare vendors, and file jobs to the Synology sales folder.

| Folder | What it is |
|---|---|
| `web/` | The website / installable web app (opens in Chrome, works offline after first visit) |
| `desktop/` | Windows desktop app (Electron) with the same tool, installer + portable exe |
| `android/` | Android app (APK) that bundles the same tool with native extras |
| `.github/workflows/build.yml` | Every push publishes the website to GitHub Pages and builds a signed APK into Releases |

**Website:** https://riverasalesindia-del.github.io/rivera-quote-studio/
**Windows app:** https://github.com/riverasalesindia-del/rivera-quote-studio/releases/latest/download/RiveraQuoteStudio-Setup.exe (or Portable .exe, no install)
**Android APK:** https://github.com/riverasalesindia-del/rivera-quote-studio/releases/latest/download/RiveraQuoteStudio.apk

Company costing data (rate card, past jobs, bank details) is **not** in this repository. Load `rivera-data-pack.json` once per device from the Rate Card page, or connect the Synology folder that holds `_rivera_register.json`.

## What the sales team gets
- **Smart Scan** – PDF, scanned PDF, photo, Excel, Word, CSV, email; every amount re-checked
- **Auto quote** – one tap: workings → quotation → register → Synology folder → share
- **Quote workings** – stator (diamond), Roebel bar, armature, equalizer, main pole, interpole, rotor pole, re-insulation
- **Quotation** – Rivera letterhead, domestic / export / service / GeM terms, PDF · Word · Excel · HTML
- **Tender database** (Tender247-style) – every tender ever seen (email alerts from GeM / CPPP / Coal India / NIC / Tender247 …, GeM direct search, Excel import, Rivera register) kept for good as live + archive; results with every bidder's price and L1; buyer and competitor analysis; one-time backfill of 3 years of old mails. Data lives in the TenderDB and TenderResults tabs of the sign-in server's Google Sheet.
- **Full GeM pull** – every live GeM bid for Rivera's keywords: all result pages of GeM search for each keyword plus every page of CPPP's list of active GeM bids, every 3 hours (runs in 15-minute slices). Shown in Tender intelligence ▸ Tender finder and the Tender database; 75%+ matches are added to Tenders automatically.
- **Team logins** – admin crm@rivera.co.in; one click in Users & access creates sales@, finance@ and operation@ with strong temporary passwords, emails each person their login and links, and forces a new password at first sign-in. Roles: admin, sales, finance, operation, viewer. Each role gets its own 8:30 morning mail.
- **Copper supplier = Swarnagiri Wire Insulations** – Swarnagiri ISO / test / copper certificates, GST and factory licence are indexed from Dropbox and Synology and used wherever a bid asks for raw-material or supplier papers; Quality Insulated Conductors papers are blocked and never go into a bid.
- **Search everywhere** – one search box on every page (Ctrl + K): pages, quotations, tenders, documents, work orders, vendors and the full tender database.
- **Each login sees only its pages** – Sales: Dashboard, Tender intelligence, Tenders & GeM, GeM Bid Desk, Tender database, Quote Workings, Quotation, Compare, Register, History & reports, Company documents, Finance requests. Finance: Finance requests and Tenders & GeM. Admin (crm@rivera.co.in): everything.
- **Finance requests** – sales asks for an EMD, bank guarantee or document; finance accepts, attaches the proof and marks it completed; sales is told by mail.
- **Go to portal + upload status** beside every Bid Desk button (Pending / In progress / Completed).
- **GeM from the office PC** – GeM only answers Indian connections, so the Windows app pulls every live and closed GeM bid for Rivera's keywords and every bidder's price and rank from GeM bid results every 3 hours. **Company lookup** shows every tender any company bid. NIC portals (etenders, Coal India, BHEL, TANGEDCO, RRVUN) need a CAPTCHA, so their tenders come in through their alert mails.
- **App top bar** – page name, search, a bell with the new Rivera-matching tenders since you last looked, your name and role, and a clear **Log out** button at the top of every page (phone: search, bell and log-out icons in the header).
- **Tender detail panel** – click any tender in the database: closing, value, EMD, match, corrigendum count, open on portal, track, shortlist, team note, add to calendar, WhatsApp, who won this buyer's earlier tenders, the buyer's other tenders and similar tenders.
- **Fast** – the server keeps the tender sheets in its cache, the app shows the last tender list from the device at once while it refreshes, and the page opens from the saved copy when mobile data is slow.
- **Synology tidy copy** – every 6 hours the app scans the connected Synology folder, stores the documents and puts a copy of each one with a standard name (RCM_<TYPE>_<party>_<date>) in `_RIVERA DOCUMENTS/<document type>/`. Original files are never moved or renamed.
- **Sales sees history** – Sales also gets the Dashboard, Register, History & reports, Compare and Company documents.
- **Company only** – every page needs a Rivera login approved by the admin; search engines are told not to list the site.
- **Leads & follow-ups (CRM)** – every enquiry (phone, email, IndiaMART, WhatsApp, visit, tender) on a drag-and-drop board: owner, value, next follow-up, call / WhatsApp / email in one tap, call-and-visit history, "Start quote workings", follow-up list (late / today / this week) and reports by source, salesperson and lost reason.
- **Repair jobs** – every motor, generator or transformer from inward DC to dispatch on a stage board: job number RJ/yy-yy/nnn, rating, serial, promised date with late alerts, printable job card, estimate, material issued from stock and turnaround reports.
- **Purchase & stock** – purchase orders (RCM/PO/yy-yy/nnn) with admin approval, print / email / WhatsApp to supplier, last purchase rate, GRN into stock, copper / insulation stock with minimum-level reorder alerts, issue to jobs, stock value and movement history.
- **My work** – follow-ups, tasks, late jobs, stock to reorder and POs to approve in one page with a 14-day calendar; tasks given to someone are mailed to them; one morning mail per person with what is due.
- **Work orders**, **Tenders & GeM** (checklist + annexure kit II–X), **Vendors, price book & RFQ**
- **Export & share** – any format, WhatsApp, email, or any app on the phone
- **Synology** – connect the SALES folder once; jobs, registers and tender kits are filed automatically

## Android app extras
- Share a PDF, Excel, Word file or WhatsApp photo to **Rivera Quotes** → it opens in Smart Scan
- "Take photo of a quotation" uses the phone camera
- Every export is saved to **Downloads › Rivera** with Open / Share (WhatsApp, Gmail, DS file)

## Build the APK yourself (optional)
Android Studio → Open `android/` → copy `web/*` into `android/app/src/main/assets/www/` → Build › Build APK.
