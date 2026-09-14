package com.example.webview;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class MyFirebaseMessagingService extends FirebaseMessagingService {

    // This method is triggered when a push notification is received
    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        // Check if the message contains a notification payload
        if (remoteMessage.getNotification() != null) {
            String title = remoteMessage.getNotification().getTitle();
            String body = remoteMessage.getNotification().getBody();
            
            // Call the method to display the notification on the screen
            showNotification(title, body);
        }
    }

    // This method is triggered when Firebase assigns a new token to the device
    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        // The token is handled in MainActivity, but you can log it here if needed
    }

    // Helper method to build and show the actual popup notification
    private void showNotification(String title, String message) {
        String channelId = "mlot_push_channel";
        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        // Android 8.0 (Oreo) and above require a Notification Channel
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    channelId, 
                    "MLOT Push Notifications", 
                    NotificationManager.IMPORTANCE_HIGH
            );
            notificationManager.createNotificationChannel(channel);
        }

        // What happens when the user taps the notification (Opens MainActivity)
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 
                0, 
                intent, 
                PendingIntent.FLAG_IMMUTABLE
        );

        // Build the visual notification
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
                .setSmallIcon(android.R.drawable.ic_dialog_info) // The small icon in the top bar
                .setContentTitle(title)
                .setContentText(message)
                .setAutoCancel(true) // Dismisses the notification when tapped
                .setContentIntent(pendingIntent);

        // Show the notification
        notificationManager.notify((int) System.currentTimeMillis(), builder.build());
    }
}
