package com.liquid.store;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

/** Receives the result of a PackageInstaller session and forwards it to the UI. */
public class InstallReceiver extends BroadcastReceiver {

    public static final String ACTION = "com.liquid.store.INSTALL_RESULT";

    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);

        Intent userAction = null;
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                userAction = intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
            } else {
                Object o = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (o instanceof Intent) userAction = (Intent) o;
            }
        } catch (Throwable ignored) {
        }

        // Some Android versions hand the confirmation UI back to us to launch.
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION && userAction != null) {
            try {
                userAction.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(userAction);
            } catch (Throwable ignored) {
            }
        }

        StoreBridge bridge = StoreBridge.INSTANCE;
        if (bridge != null) {
            bridge.onInstallResult(status, message);
        }
    }
}
