package com.bytebikri.app.security

import android.app.Activity
import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Build
import android.provider.Settings
import androidx.core.content.getSystemService
import kotlinx.coroutines.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class SecurityManager(private val context: Context) {
    private val prefs = context.getSharedPreferences("security_prefs", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    companion object {
        private const val ATTEMPT_COUNT_KEY = "attempt_count"
        private const val BLOCKED_KEY = "app_blocked"
        private const val MAX_ATTEMPTS = 3
        // ⚠️ CHANGE THIS to your Replit URL after deployment
        private const val BASE_URL = "https://your-replit-url.repl.co"
    }

    fun getAttemptCount(): Int {
        return prefs.getInt(ATTEMPT_COUNT_KEY, 0)
    }

    fun isAppBlocked(): Boolean {
        return prefs.getBoolean(BLOCKED_KEY, false)
    }

    fun incrementAttempt(reason: String) {
        val currentCount = getAttemptCount() + 1
        prefs.edit().putInt(ATTEMPT_COUNT_KEY, currentCount).apply()

        if (currentCount >= MAX_ATTEMPTS) {
            blockApp(reason)
        }
    }

    private fun blockApp(reason: String) {
        prefs.edit().putBoolean(BLOCKED_KEY, true).apply()
        notifyAdmin(reason, getAttemptCount())
        
        (context as? Activity)?.finishAffinity()
        android.os.Process.killProcess(android.os.Process.myPid())
    }

    fun checkScreenRecording() {
        if (isScreenBeingRecorded()) {
            incrementAttempt("Screen recording detected")
        }
    }

    private fun isScreenBeingRecorded(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val displayManager = context.getSystemService<DisplayManager>()
                val displays = displayManager?.displays
                
                displays?.forEach { display ->
                    if (display.flags and android.view.Display.FLAG_PRESENTATION != 0) {
                        return true
                    }
                }
            } catch (e: Exception) {
                // Silently handle
            }
        }
        return false
    }

    fun checkSensitiveAction(action: String): Boolean {
        if (isAppBlocked()) {
            return false
        }
        return true
    }

    private fun notifyAdmin(reason: String, attempts: Int) {
        scope.launch {
            try {
                val userId = prefs.getString("user_id", "unknown") ?: "unknown"
                val deviceId = getDeviceId()
                
                val json = JSONObject().apply {
                    put("userId", userId)
                    put("deviceId", deviceId)
                    put("attempts", attempts)
                    put("reason", reason)
                    put("timestamp", System.currentTimeMillis())
                    put("deviceModel", Build.MODEL)
                    put("androidVersion", Build.VERSION.RELEASE)
                }

                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$BASE_URL/api/admin/security-alert")
                    .post(body)
                    .build()

                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        println("Failed to notify admin: ${response.code}")
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun getDeviceId(): String {
        return Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID
        ) ?: "unknown"
    }

    fun setUserId(userId: String) {
        prefs.edit().putString("user_id", userId).apply()
    }

    fun resetAttempts() {
        prefs.edit()
            .putInt(ATTEMPT_COUNT_KEY, 0)
            .putBoolean(BLOCKED_KEY, false)
            .apply()
    }
}