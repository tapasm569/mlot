package com.example.webview;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
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
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.firebase.FirebaseApp;
import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private String fcmDeviceToken = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Explicitly initialize Firebase to prevent silent hanging
        FirebaseApp.initializeApp(this);

        // REQUIRED FOR ANDROID 13+: Ask user for permission to show notifications
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }

        webView = findViewById(R.id.webView);
        setupWebView();

        // Register the JavaScript Interface
        webView.addJavascriptInterface(new WebAppInterface(this), "AndroidBridge");

        // Fetch the FCM Push Notification Token
        fetchFirebaseToken();

        // Load your local HTML file
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void setupWebView() {
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true); // Keeps user logged in
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowFileAccessFromFileURLs(true);
        webSettings.setAllowUniversalAccessFromFileURLs(true);
        webSettings.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("tel:") || url.startsWith("whatsapp:") || url.startsWith("upi:")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "App not installed to handle this action", Toast.LENGTH_SHORT).show();
                    }
                    return true; 
                }
                return false; 
            }
        });
    }

    private void fetchFirebaseToken() {
        // Immediate popup to prove this method is running
        Toast.makeText(this, "Requesting Firebase Token...", Toast.LENGTH_SHORT).show();

        FirebaseMessaging.getInstance().getToken()
            .addOnCompleteListener(new OnCompleteListener<String>() {
                @Override
                public void onComplete(@NonNull Task<String> task) {
                    if (!task.isSuccessful()) {
                        Log.w("FCM", "Fetching FCM registration token failed", task.getException());
                        Toast.makeText(MainActivity.this, "Firebase Token Failed: Check JSON or Network", Toast.LENGTH_LONG).show();
                        return;
                    }

                    // Get new FCM registration token
                    fcmDeviceToken = task.getResult();
                    Log.d("FCM", "Device Token: " + fcmDeviceToken);
                    
                    Toast.makeText(MainActivity.this, "FCM Token Generated Successfully!", Toast.LENGTH_SHORT).show();

                    // Send the token directly to the running HTML file
                    sendTokenToWebView(fcmDeviceToken);
                }
            });
    }

    private void sendTokenToWebView(String token) {
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript("javascript:if(window.receiveFCMTokenFromAndroid) window.receiveFCMTokenFromAndroid('" + token + "');", null);
            }
        });
    }

    public class WebAppInterface {
        Context mContext;

        WebAppInterface(Context c) {
            mContext = c;
        }

        @JavascriptInterface
        public String getFCMToken() {
            return fcmDeviceToken;
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
