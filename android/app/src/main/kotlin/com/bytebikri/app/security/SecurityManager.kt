package com.bytebikri.app.security

import android.app.Activity
import android.os.Build
import android.view.WindowManager

/**
 * Screenshots, honestly.
 *
 * WHAT ACTUALLY WORKS: `FLAG_SECURE` on the window. Android enforces it in the
 * compositor, so screenshots, screen recordings, the Recents thumbnail and
 * casting all render black — on Android 14 and 15 as well. It is per-WINDOW, so
 * every dialog and every Activity that shows locked content must set it, which
 * is why `protect()` exists rather than a single call in `onCreate`.
 *
 * WHAT DOES NOT WORK, and was in this file before:
 *
 *   - `Display.FLAG_PRESENTATION` as "is the screen being recorded". That flag
 *     means "this is a presentation/cast display". It is not a recording
 *     detector and never was; on a normal phone it is simply always false, so
 *     the check was a no-op dressed as security.
 *   - Blocking the app after three "detections" and killing the process. There
 *     was no detection to count, and the response to a false positive was to
 *     terminate the user's app. A security feature whose failure mode is
 *     punishing a paying user is worse than no feature.
 *   - Posting the device id to `/api/admin/security-alert` on a placeholder
 *     domain. An endpoint that does not exist cannot receive an alert, and
 *     shipping a device identifier to one would be a privacy problem even if it
 *     did.
 *
 * WHAT EXISTS FROM ANDROID 14: `registerScreenCaptureCallback` tells an Activity
 * that its content IS being captured, so the app can stop playback or log it.
 * Below API 34 there is no public API for this — the honest answer is that the
 * platform does not tell us, not that we detect it some other way.
 *
 * The control that matters is not detection anyway. `FLAG_SECURE` prevents; the
 * watermark makes whatever escapes traceable to an account; and the app tells
 * the user both of those things in plain words instead of implying invincibility.
 */
class SecurityManager(private val activity: Activity) {

    fun protect() {
        activity.window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE,
        )
    }

    /** Only needed for dialogs or secondary windows created after onCreate. */
    fun protect(window: android.view.Window) {
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE,
        )
    }

    /** True when the platform can report a screenshot at all. */
    val canDetectScreenshots: Boolean get() = Build.VERSION.SDK_INT >= 34

    /**
     * Listen for screenshots of this Activity.
     *
     * Android 14 added `Activity.registerScreenCaptureCallback`, whose interface
     * is `Activity.ScreenCaptureCallback` with a single method, `onScreenCaptured`.
     * It fires when the user presses the hardware screenshot combination — that
     * is the whole of it. It cannot see a screen recorder, and it does not exist
     * below API 34, which is why the return value is nullable rather than a
     * boolean that is quietly false.
     *
     * What to do when it fires is a product decision, and the answer is NOT to
     * punish anyone: pause playback, or note it. Killing the user's session
     * because they screenshotted their own unlocked file is not security.
     */
    fun watchForScreenshots(onCaptured: () -> Unit): AutoCloseable? {
        if (Build.VERSION.SDK_INT < 34) return null
        return try {
            val callback = Activity.ScreenCaptureCallback { onCaptured() }
            activity.registerScreenCaptureCallback(activity.mainExecutor, callback)
            AutoCloseable {
                runCatching { activity.unregisterScreenCaptureCallback(callback) }
            }
        } catch (e: Throwable) {
            null
        }
    }
}
