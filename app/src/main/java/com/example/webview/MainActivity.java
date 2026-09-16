package com.example.webview;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;

import java.io.OutputStream;

public class MainActivity extends AppCompatActivity {

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            setContentView(R.layout.activity_main);
            webView = findViewById(R.id.webView);
        } catch (Exception e) {
            Log.e("MainActivity", "Could not load activity_main XML: " + e.getMessage());
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

            // Register the JavaScript-to-Android Bridge
            webView.addJavascriptInterface(new WebAppInterface(this), "AndroidBridge");

            // Load local index.html from assets
            webView.loadUrl("file:///android_asset/index.html");
            
        } catch (Exception e) {
            Log.e("MainActivity", "Error configuring WebView: " + e.getMessage());
        }
    }

    // --- NATIVE BRIDGE CLASS TO SAVE PDF TO ANDROID DOWNLOADS ---
    public class WebAppInterface {
        Context mContext;

        WebAppInterface(Context c) {
            mContext = c;
        }

        @JavascriptInterface
        public void savePDFFromBase64(String base64Data, String fileName) {
            try {
                byte[] pdfAsBytes = Base64.decode(base64Data, Base64.DEFAULT);
                ContentValues contentValues = new ContentValues();
                contentValues.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                contentValues.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
                
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    contentValues.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                }

                Uri uri = mContext.getContentResolver().insert(MediaStore.Files.getContentUri("external"), contentValues);
                if (uri != null) {
                    OutputStream fos = mContext.getContentResolver().openOutputStream(uri);
                    if (fos != null) {
                        fos.write(pdfAsBytes);
                        fos.flush();
                        fos.close();
                    }
                }

                ((Activity) mContext).runOnUiThread(new Runnable() {
                    public void run() {
                        Toast.makeText(mContext, "PDF Saved to Downloads Folder!", Toast.LENGTH_LONG).show();
                    }
                });

            } catch (Exception e) {
                ((Activity) mContext).runOnUiThread(new Runnable() {
                    public void run() {
                        Toast.makeText(mContext, "Failed to save PDF: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    }
                });
            }
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
