package com.example.webview;

import android.os.Bundle;
import android.util.Log;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Safely load your layout XML file
        try {
            setContentView(R.layout.activity_main);
            webView = findViewById(R.id.webView);
        } catch (Exception e) {
            Log.e("MainActivity", "Could not load activity_main XML: " + e.getMessage());
        }

        // Fallback safety: if layout ID is missing, create WebView dynamically
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
            webSettings.setJavaScriptCanOpenWindowsAutomatically(true);

            // Load your local index.html from the assets folder
            webView.loadUrl("file:///android_asset/index.html");
            
        } catch (Exception e) {
            Log.e("MainActivity", "Error configuring WebView settings: " + e.getMessage());
        }
    }

    // Handle the device's physical back button to navigate inside the WebView history
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
