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
- **Work orders**, **Tenders & GeM** (checklist + annexure kit II–X), **Vendors, price book & RFQ**
- **Export & share** – any format, WhatsApp, email, or any app on the phone
- **Synology** – connect the SALES folder once; jobs, registers and tender kits are filed automatically

## Android app extras
- Share a PDF, Excel, Word file or WhatsApp photo to **Rivera Quotes** → it opens in Smart Scan
- "Take photo of a quotation" uses the phone camera
- Every export is saved to **Downloads › Rivera** with Open / Share (WhatsApp, Gmail, DS file)

## Build the APK yourself (optional)
Android Studio → Open `android/` → copy `web/*` into `android/app/src/main/assets/www/` → Build › Build APK.
