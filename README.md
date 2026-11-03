# Rivera Quote Studio

Sales quotation tool for Rivera Coil Manufacturing (I) Pvt Ltd: scan enquiries and vendor quotations, build QUOTE WORKINGS, issue quotations with terms, compare vendors, and file jobs to the Synology sales folder.

| Folder | What it is |
|---|---|
| `web/` | The website / installable web app (opens in Chrome, works offline after first visit) |
| `android/` | Android app (APK) that bundles the same tool with native extras |
| `.github/workflows/build.yml` | Every push publishes the website to GitHub Pages and builds a signed APK into Releases |

**Website:** https://riverasalesindia-del.github.io/rivera-quote-studio/
**Android APK:** https://github.com/riverasalesindia-del/rivera-quote-studio/releases/latest/download/RiveraQuoteStudio.apk

Company costing data (rate card, past jobs, bank details) is **not** in this repository. Load `rivera-data-pack.json` once per device from the Rate Card page, or connect the Synology folder that holds `_rivera_register.json`.

## Android app extras
- Share a PDF, Excel, Word file or WhatsApp photo to **Rivera Quotes** → it opens in Smart Scan
- "Take photo of a quotation" uses the phone camera
- Every export is saved to **Downloads › Rivera** with Open / Share (WhatsApp, Gmail, DS file)

## Build the APK yourself (optional)
Android Studio → Open `android/` → copy `web/*` into `android/app/src/main/assets/www/` → Build › Build APK.
