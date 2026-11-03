package com.rivera.quotestudio;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Rivera Quote Studio — Android shell.
 * Serves the bundled web app from assets on a secure origin, and adds native tools:
 * file + camera picking, saving exports to Downloads/Rivera with Open / Share,
 * and receiving files shared from WhatsApp, Gmail or the file manager straight into Smart Scan.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/www/index.html#home";
    private static final int REQ_FILES = 1001;
    private static final long MAX_SHARE_BYTES = 30L * 1024 * 1024;

    private WebView web;
    private WebViewAssetLoader loader;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private boolean pageReady = false;
    private String pendingSharedJson = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#EEF1F0"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " RiveraQuoteStudio/" + versionName());

        web.addJavascriptInterface(new Bridge(), "RiveraAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception e) {
                    toast("No app can open this link");
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                if (pendingSharedJson != null) {
                    deliverShared(pendingSharedJson);
                    pendingSharedJson = null;
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                return openChooser(params);
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START);

        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /* ---------- picking files and taking photos ---------- */
    private boolean openChooser(WebChromeClient.FileChooserParams params) {
        Intent camera = null;
        try {
            File dir = new File(getCacheDir(), "camera");
            if (!dir.exists()) dir.mkdirs();
            File photo = new File(dir, "quotation_" + System.currentTimeMillis() + ".jpg");
            cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".files", photo);
            camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
            camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception e) {
            cameraUri = null;
        }
        try {
            if (params != null && params.isCaptureEnabled() && camera != null) {
                startActivityForResult(camera, REQ_FILES);
                return true;
            }
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType("*/*");
            boolean multiple = params != null && params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;
            pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
            String[] accept = params != null ? params.getAcceptTypes() : null;
            if (accept != null && accept.length == 1 && accept[0] != null && accept[0].startsWith("image/")) pick.setType("image/*");
            Intent chooser = Intent.createChooser(pick, "Choose quotation files");
            if (camera != null) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
            startActivityForResult(chooser, REQ_FILES);
            return true;
        } catch (Exception e) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = null;
            toast("Can't open the file picker");
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILES || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            List<Uri> uris = new ArrayList<>();
            if (data != null && data.getClipData() != null) {
                ClipData c = data.getClipData();
                for (int i = 0; i < c.getItemCount(); i++) uris.add(c.getItemAt(i).getUri());
            } else if (data != null && data.getData() != null) {
                uris.add(data.getData());
            } else if (cameraUri != null) {
                uris.add(cameraUri);
            }
            if (!uris.isEmpty()) result = uris.toArray(new Uri[0]);
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    /* ---------- files shared into the app ---------- */
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        List<Uri> uris = new ArrayList<>();
        try {
            if (Intent.ACTION_SEND.equals(action)) {
                Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (u != null) uris.add(u);
                else {
                    String text = intent.getStringExtra(Intent.EXTRA_TEXT);
                    if (text != null && !text.trim().isEmpty()) {
                        JSONArray arr = new JSONArray();
                        JSONObject o = new JSONObject();
                        o.put("name", "shared-text.txt");
                        o.put("type", "text/plain");
                        o.put("b64", Base64.encodeToString(text.getBytes("UTF-8"), Base64.NO_WRAP));
                        arr.put(o);
                        queueShared(arr.toString());
                        return;
                    }
                }
            } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (list != null) uris.addAll(list);
            } else if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null && "content".equals(intent.getData().getScheme())) {
                uris.add(intent.getData());
            }
            if (uris.isEmpty()) return;
            JSONArray arr = new JSONArray();
            for (Uri u : uris) {
                byte[] bytes = readAll(u);
                if (bytes == null) continue;
                JSONObject o = new JSONObject();
                o.put("name", displayName(u));
                String type = getContentResolver().getType(u);
                o.put("type", type == null ? "" : type);
                o.put("b64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                arr.put(o);
            }
            if (arr.length() > 0) queueShared(arr.toString());
            intent.setAction(null);
        } catch (Exception e) {
            toast("Couldn't open the shared file");
        }
    }

    private void queueShared(String json) {
        if (pageReady) deliverShared(json);
        else pendingSharedJson = json;
    }

    private void deliverShared(String json) {
        web.evaluateJavascript("window.riveraReceiveFiles && window.riveraReceiveFiles(" + json + ")", null);
    }

    private byte[] readAll(Uri u) {
        try (InputStream in = getContentResolver().openInputStream(u)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            long total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_SHARE_BYTES) {
                    toast("File is larger than 30 MB");
                    return null;
                }
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    private String displayName(Uri u) {
        String name = null;
        try (Cursor c = getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) {
        }
        if (name == null) name = u.getLastPathSegment();
        return name == null ? "shared-file" : name;
    }

    /* ---------- saving exports ---------- */
    private Uri saveToDownloads(String name, String mime, byte[] bytes) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Rivera");
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new Exception("insert failed");
            try (OutputStream os = cr.openOutputStream(uri)) {
                if (os == null) throw new Exception("open failed");
                os.write(bytes);
            }
            return uri;
        } else {
            File dir = new File(getExternalFilesDir(null), "Download");
            if (!dir.exists()) dir.mkdirs();
            File f = new File(dir, name);
            try (FileOutputStream os = new FileOutputStream(f)) {
                os.write(bytes);
            }
            return FileProvider.getUriForFile(this, getPackageName() + ".files", f);
        }
    }

    private void afterSave(final String name, final String mime, final Uri uri) {
        String where = Build.VERSION.SDK_INT >= 29 ? "Downloads › Rivera" : "the app's Download folder";
        new AlertDialog.Builder(this)
                .setTitle("Saved")
                .setMessage(name + "\nis in " + where + ".")
                .setPositiveButton("Open", (d, w) -> {
                    try {
                        Intent i = new Intent(Intent.ACTION_VIEW);
                        i.setDataAndType(uri, mime);
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(i);
                    } catch (Exception e) {
                        toast("No app installed to open this file type");
                    }
                })
                .setNeutralButton("Share", (d, w) -> {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType(mime);
                    i.putExtra(Intent.EXTRA_STREAM, uri);
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(i, "Share " + name));
                })
                .setNegativeButton("Done", null)
                .show();
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1.0";
        }
    }

    private void toast(final String msg) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
    }

    /** Called from the web app as window.RiveraAndroid.* */
    private class Bridge {
        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String b64) {
            try {
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                final String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                final String mt = (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime;
                final Uri uri = saveToDownloads(safe, mt, bytes);
                runOnUiThread(() -> afterSave(safe, mt, uri));
            } catch (Exception e) {
                toast("Couldn't save " + name);
            }
        }

        @JavascriptInterface
        public String appVersion() {
            return versionName();
        }
    }
}
