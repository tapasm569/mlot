package com.example.webview;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;

public class MainActivity extends AppCompatActivity {

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            setContentView(R.layout.activity_main);
            webView = findViewById(R.id.webView);
        } catch (Exception e) {
            Log.e("MainActivity", "Could not load layout XML: " + e.getMessage());
        }

        if (webView == null) {
            webView = new WebView(this);
            setContentView(webView);
        }

        try {
            WebSettings webSettings = webView.getSettings();
            webSettings.setJavaScriptEnabled(true);
            webSettings.setDomStorageEnabled(true);
            webSettings.setLoadWithOverviewMode(true);
            webSettings.setUseWideViewPort(true);
            webSettings.setAllowFileAccess(true);
            webSettings.setDatabaseEnabled(true);

            // Register AndroidBridge with the direct PDF opener and WhatsApp share methods
            webView.addJavascriptInterface(new WebAppInterface(this), "AndroidBridge");

            webView.loadUrl("file:///android_asset/index.html");

        } catch (Exception e) {
            Log.e("MainActivity", "Error configuring WebView: " + e.getMessage());
        }
    }

    public class WebAppInterface {
        Context mContext;

        WebAppInterface(Context c) {
            mContext = c;
        }

        // 1. Instantly open PDF in default device reader (Drive PDF Viewer, Adobe, etc.)
        @JavascriptInterface
        public void openPDFDirectly(String base64Data, String fileName) {
            try {
                File pdfFile = writeBase64ToFile(base64Data, fileName);
                Uri fileUri = FileProvider.getUriForFile(
                        mContext,
                        mContext.getPackageName() + ".provider",
                        pdfFile
                );

                Intent viewIntent = new Intent(Intent.ACTION_VIEW);
                viewIntent.setDataAndType(fileUri, "application/pdf");
                viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                Intent chooser = Intent.createChooser(viewIntent, "Open PDF with...");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                mContext.startActivity(chooser);

            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(mContext, "Cannot open PDF: " + e.getMessage(), Toast.LENGTH_SHORT).show());
            }
        }

        // 2. Attach PDF and open chat directly in WhatsApp
        @JavascriptInterface
        public void sharePDFToWhatsApp(String base64Data, String fileName, String phoneNumber) {
            try {
                File pdfFile = writeBase64ToFile(base64Data, fileName);
                Uri fileUri = FileProvider.getUriForFile(
                        mContext,
                        mContext.getPackageName() + ".provider",
                        pdfFile
                );

                // Clean phone number: remove spaces, symbols, and formatting
                String cleanPhone = phoneNumber != null ? phoneNumber.replaceAll("[^0-9]", "") : "";
                if (cleanPhone.length() == 10) {
                    cleanPhone = "91" + cleanPhone; // Default to India (+91) if standard 10 digits
                }

                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType("application/pdf");
                shareIntent.putExtra(Intent.EXTRA_STREAM, fileUri);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                shareIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                if (!cleanPhone.isEmpty()) {
                    shareIntent.putExtra("jid", cleanPhone + "@s.whatsapp.net");
                }
                shareIntent.setPackage("com.whatsapp");

                try {
                    mContext.startActivity(shareIntent);
                } catch (Exception noWhatsApp) {
                    // Try WhatsApp Business if normal WhatsApp isn't present
                    shareIntent.setPackage("com.whatsapp.w4b");
                    mContext.startActivity(shareIntent);
                }

            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(mContext, "WhatsApp share failed: " + e.getMessage(), Toast.LENGTH_SHORT).show());
            }
        }

        private File writeBase64ToFile(String base64Data, String fileName) throws Exception {
            byte[] pdfBytes = Base64.decode(base64Data, Base64.DEFAULT);
            File cachePath = new File(mContext.getExternalCacheDir(), "reports");
            if (!cachePath.exists()) {
                cachePath.mkdirs();
            }
            File file = new File(cachePath, fileName);
            FileOutputStream fos = new FileOutputStream(file);
            fos.write(pdfBytes);
            fos.flush();
            fos.close();
            return file;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
        }
