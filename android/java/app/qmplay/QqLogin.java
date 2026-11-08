package app.qmplay;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

/** Open the short-lived QR challenge in QQ so the local backend can poll its result. */
final class QqLogin {
    static boolean open(Activity activity, String url) {
        if (url == null || !url.matches("https://txz\\.qq\\.com/p\\?k=[A-Za-z0-9_-]{32}&f=[0-9]{1,12}"))
            return false;
        // QQ selects its QR login handler only when both parameters are present.
        Uri target = new Uri.Builder().scheme("wtloginmqq").authority("ptlogin").path("qlogin")
            .appendQueryParameter("qrcode", url)
            .appendQueryParameter("schemacallback", "qmplay-qq://return")
            .build();
        try {
            // QQ sends its authorization task to the background when the dialog closes.
            activity.startActivity(new Intent(Intent.ACTION_VIEW, target)
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .setPackage("com.tencent.mobileqq"));
            return true;
        } catch (ActivityNotFoundException | SecurityException error) {
            return false;
        }
    }
}
