package com.example.webview;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;

import java.io.OutputStream;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private final static int FILE_CHOOSER_RESULT_CODE = 1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setTheme(R.style.Theme_App);
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);

        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowContentAccess(true);
        webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Enable cookies and persistent storage to keep you logged in permanently
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptFileSchemeCookies(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        // Add JavaScript interface to handle blob and data URL downloads
        webView.addJavascriptInterface(new WebAppInterface(this), "AndroidBridge");

        // CRITICAL: Handle UPI, WhatsApp, and Phone Call intents externally
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("upi://") || url.startsWith("tel:") || url.startsWith("whatsapp://") || url.startsWith("https://wa.me/")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                        return true;
                    } catch (Exception e) {
                        return false; 
                    }
                }
                return false; 
            }
        });

        // Handle file selection and uploads (payment screenshots, documents)
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;

                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_RESULT_CODE);
                } catch (Exception e) {
                    MainActivity.this.filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        // HANDLE STANDARD, BLOB, AND DATA URL PDF DOWNLOADS
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
                if (filename.equals("downloadfile.bin") || filename.isEmpty()) {
                    filename = "document_" + System.currentTimeMillis() + ".pdf";
                }

                if (url.startsWith("blob:") || url.startsWith("data:")) {
                    // Inject JS to fetch blob data and send it to AndroidBridge
                    String jsScript = "(async function() {" +
                            "try {" +
                            "  const response = await fetch('" + url + "');" +
                            "  const blob = await response.blob();" +
                            "  const reader = new FileReader();" +
                            "  reader.onload = function() {" +
                            "    AndroidBridge.saveBase64File(reader.result, '" + filename + "', blob.type || '" + mimeType + "');" +
                            "  };" +
                            "  reader.readAsDataURL(blob);" +
                            "} catch(e) { console.error(e); }" +
                            "})();";
                    webView.evaluateJSON(jsScript, null);
                } else {
                    try {
                        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                        request.allowScanningByMediaScanner();
                        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                        
                        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                        if (dm != null) {
                            dm.enqueue(request);
                            Toast.makeText(getApplicationContext(), "Downloading file...", Toast.LENGTH_SHORT).show();
                        }
                    } catch (Exception e) {
                        Toast.makeText(getApplicationContext(), "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    }
                }
            }
        });

        webView.loadUrl("file:///android_asset/index.html");
    }

    // JavaScript Bridge class to handle saving base64 content to storage
    public static class WebAppInterface {
        Context mContext;

        WebAppInterface(Context c) {
            mContext = c;
        }

        @JavascriptInterface
        public void saveBase64File(String base64Data, String fileName, String mimeType) {
            try {
                String base64Image = base64Data;
                if (base64Data.contains(",")) {
                    base64Image = base64Data.split(",")[1];
                }
                byte[] decodedBytes = Base64.decode(base64Image, Base64.DEFAULT);

                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType.isEmpty() ? "application/pdf" : mimeType);
                values.put(MediaStore.Downloads.IS_PENDING, 1);

                ContentResolver resolver = mContext.getContentResolver();
                Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                Uri itemUri = resolver.insert(collection, values);

                if (itemUri != null) {
                    try (OutputStream out = resolver.openOutputStream(itemUri)) {
                        out.write(decodedBytes);
                    }
                    values.clear();
                    values.put(MediaStore.Downloads.IS_PENDING, 0);
                    resolver.update(itemUri, values, null, null);

                    Handler handler = new Handler(Looper.getMainLooper());
                    handler.post(() -> Toast.makeText(mContext, "PDF downloaded successfully", Toast.LENGTH_SHORT).show());
                }
            } catch (Exception e) {
                Handler handler = new Handler(Looper.getMainLooper());
                handler.post(() -> Toast.makeText(mContext, "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent intent) {
        super.onActivityResult(requestCode, resultCode, intent);
        if (requestCode == FILE_CHOOSER_RESULT_CODE) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && intent != null) {
                String dataString = intent.getDataString();
                if (dataString != null) {
                    results = new Uri[]{Uri.parse(dataString)};
                } else if (intent.getClipData() != null) {
                    int count = intent.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = intent.getClipData().getItemAt(i).getUri();
                    }
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
                            }
