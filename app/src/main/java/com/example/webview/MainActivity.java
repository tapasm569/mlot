package com.example.webview;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private String fcmDeviceToken = null; // Stores the token locally

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView); // Make sure your activity_main.xml has a WebView with this ID
        setupWebView();

        // Register the JavaScript Interface so HTML can talk to Android
        webView.addJavascriptInterface(new WebAppInterface(this), "AndroidBridge");

        // Fetch the FCM Push Notification Token
        fetchFirebaseToken();

        // Load your local HTML file
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void setupWebView() {
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true); // CRITICAL: Allows localStorage to keep users logged in
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowFileAccessFromFileURLs(true);
        webSettings.setAllowUniversalAccessFromFileURLs(true);
        webSettings.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // Intercept external links (WhatsApp, UPI, Phone Dialer)
                if (url.startsWith("tel:") || url.startsWith("whatsapp:") || url.startsWith("upi:")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "App not installed to handle this action", Toast.LENGTH_SHORT).show();
                    }
                    return true; // Tell WebView we handled it
                }
                return false; // Let WebView handle normal web links
            }
        });
    }

    private void fetchFirebaseToken() {
        FirebaseMessaging.getInstance().getToken()
            .addOnCompleteListener(new OnCompleteListener<String>() {
                @Override
                public void onComplete(@NonNull Task<String> task) {
                    if (!task.isSuccessful()) {
                        Log.w("FCM", "Fetching FCM registration token failed", task.getException());
                        return;
                    }

                    // Get new FCM registration token
                    fcmDeviceToken = task.getResult();
                    Log.d("FCM", "Device Token: " + fcmDeviceToken);

                    // Send the token directly to the running HTML file
                    sendTokenToWebView(fcmDeviceToken);
                }
            });
    }

    // Method to inject the token into the HTML via JavaScript
    private void sendTokenToWebView(String token) {
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript("javascript:if(window.receiveFCMTokenFromAndroid) window.receiveFCMTokenFromAndroid('" + token + "');", null);
            }
        });
    }

    // --- JAVASCRIPT BRIDGE ---
    // This allows the index.html file to call Android methods
    public class WebAppInterface {
        Context mContext;

        WebAppInterface(Context c) {
            mContext = c;
        }

        // The HTML file uses window.AndroidBridge.getFCMToken() to grab the token
        @JavascriptInterface
        public String getFCMToken() {
            return fcmDeviceToken;
        }

        // Example: Optional method if you want HTML to trigger an Android Toast
        @JavascriptInterface
        public void showToast(String toast) {
            Toast.makeText(mContext, toast, Toast.LENGTH_SHORT).show();
        }
    }

    // Handle back button to go back in WebView history instead of closing the app
    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
