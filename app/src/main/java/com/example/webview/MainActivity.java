package com.example.webview;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
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

import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private String fcmDeviceToken = null;
    private static final String CHANNEL_ID = "mlot_push_channel";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        FirebaseApp.initializeApp(this);
        createNotificationChannel();

        // Android 13+ Notification Runtime Permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }

        webView = findViewById(R.id.webView);
        setupWebView();

        webView.addJavascriptInterface(new WebAppInterface(this), "AndroidBridge");

        // Verify Play Services & Fetch Token
        checkPlayServicesAndFetchToken();

        webView.loadUrl("file:///android_asset/index.html");
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "MLOT Notifications",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Transaction and stock alerts");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void setupWebView() {
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowFileAccessFromFileURLs(true);
        webSettings.setAllowUniversalAccessFromFileURLs(true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("tel:") || url.startsWith("whatsapp:") || url.startsWith("upi:")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "App not available for this action", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }
                return false;
            }
        });
    }

    private void checkPlayServicesAndFetchToken() {
        GoogleApiAvailability apiAvailability = GoogleApiAvailability.getInstance();
        int resultCode = apiAvailability.isGooglePlayServicesAvailable(this);

        if (resultCode != ConnectionResult.SUCCESS) {
            if (apiAvailability.isUserResolvableError(resultCode)) {
                apiAvailability.getErrorDialog(this, resultCode, 9000).show();
            } else {
                Toast.makeText(this, "Device unsupported: Missing Google Play Services", Toast.LENGTH_LONG).show();
            }
            return;
        }

        fetchFirebaseToken();
    }

    private void fetchFirebaseToken() {
        FirebaseMessaging.getInstance().getToken()
            .addOnCompleteListener(task -> {
                if (!task.isSuccessful()) {
                    String err = task.getException() != null ? task.getException().getMessage() : "Unknown";
                    Log.e("FCM", "Token retrieval failed: " + err);
                    Toast.makeText(MainActivity.this, "FCM Error: " + err, Toast.LENGTH_LONG).show();
                    return;
                }

                fcmDeviceToken = task.getResult();
                Log.d("FCM", "FCM Device Token: " + fcmDeviceToken);
                Toast.makeText(MainActivity.this, "Token Generated Successfully!", Toast.LENGTH_SHORT).show();
                sendTokenToWebView(fcmDeviceToken);
            })
            .addOnFailureListener(e -> {
                Toast.makeText(MainActivity.this, "Hard Failure: " + e.getMessage(), Toast.LENGTH_LONG).show();
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
