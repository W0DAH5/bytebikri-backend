package com.bytebikri.app.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * The server, as it actually is.
 *
 * The previous version of this file called `/api/signup`, `/api/signin`,
 * `/api/assets`, `/api/upload`, `/api/coins/{id}`, `/api/spend` and three
 * `/api/admin/*` routes. Not one of them exists. Every screen in the app was
 * built on that contract, which is why the app could never have worked — and why
 * it is worth saying out loud that this file is now written against the routes
 * in `server.js`, checked by `app/test/android-contract.test.js`.
 *
 * Three product decisions are load-bearing here and are easy to undo by accident:
 *
 *   1. THERE IS NO PRICE. Unlocking is: watch N rewarded ads, the network pays
 *      the creator's own account, bytebikri is not in that path. So there is no
 *      wallet, no coins, no purchase call, and no balance to cache.
 *   2. THERE IS NO ADMIN CONSOLE IN THE APP. Moderation is the operator's job on
 *      the server, not a screen with a ban button on somebody's phone.
 *   3. THE SESSION IS THE CREDENTIAL. The server's content routes check the
 *      session AND the signed token AND that the token belongs to that session,
 *      so a forwarded stream URL is inert. The client holds a cookie; it never
 *      holds anything secret.
 */
class ApiService(val baseUrl: String) {

    /**
     * Cookies in memory, and only in memory.
     *
     * A session cookie written to disk on a shared phone is a session someone
     * else can resume. Nothing here needs to survive the process, so nothing
     * does — the user signs in again, which is the correct cost.
     */
    private class MemoryCookieJar : CookieJar {
        private val store = mutableMapOf<String, MutableList<Cookie>>()

        @Synchronized
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            val list = store.getOrPut(url.host) { mutableListOf() }
            for (cookie in cookies) {
                list.removeAll { it.name == cookie.name }
                list.add(cookie)
            }
        }

        @Synchronized
        override fun loadForRequest(url: HttpUrl): List<Cookie> =
            store[url.host].orEmpty().filter { it.matches(url) }
    }

    private val cookies = MemoryCookieJar()

    private val client = OkHttpClient.Builder()
        .cookieJar(cookies)
        .connectTimeout(20, TimeUnit.SECONDS)
        // Playback is a long-lived response: a short read timeout would cut a
        // video off mid-stream and look like a broken file.
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    // A 302 after a form POST is success; following it would hide the difference
    // between "welcome back" and "wrong password" behind a 200 render.
    private val noRedirects = client.newBuilder().followRedirects(false).build()

    private fun url(path: String) = "$baseUrl$path"

    private suspend fun get(path: String): JSONObject = withContext(Dispatchers.IO) {
        client.newCall(Request.Builder().url(url(path)).get().build()).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw ApiException(res.code, errorFrom(text, res.code))
            JSONObject(text)
        }
    }

    private suspend fun postJson(path: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(url(path))
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(request).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw ApiException(res.code, errorFrom(text, res.code))
            JSONObject(text)
        }
    }

    private fun errorFrom(text: String, code: Int): String =
        runCatching { JSONObject(text).optString("error") }
            .getOrNull()
            ?.takeIf { it.isNotBlank() }
            ?: "The server said $code. Try again."

    // ── sign in ──────────────────────────────────────────────────────────────

    /**
     * The web form, posted from the app.
     *
     * Deliberately the same endpoint the website uses: one authentication path
     * with one set of lockout rules and one audit trail, rather than a second
     * one written for the app and tested less. The response is a redirect on
     * success — which is why redirects are off here and `302` is the check.
     */
    suspend fun signIn(email: String, password: String): Unit = withContext(Dispatchers.IO) {
        val form = okhttp3.FormBody.Builder()
            .add("email", email)
            .add("password", password)
            .build()
        val request = Request.Builder().url(url("/login")).post(form).build()

        noRedirects.newCall(request).execute().use { res ->
            when (res.code) {
                in 300..399 -> Unit                       // redirect = signed in
                429 -> throw ApiException(429, "Too many failed attempts. Try again in about fifteen minutes.")
                400 -> throw ApiException(400, "Enter your email and password.")
                else -> throw ApiException(res.code, "That email and password do not match an account.")
            }
        }
    }

    // ── browsing ─────────────────────────────────────────────────────────────

    /** A storefront. Public: the first screen must render before anyone signs in. */
    suspend fun store(slug: String): Store = withContext(Dispatchers.IO) {
        val json = get("/api/stores/$slug")
        val store = json.getJSONObject("store")
        val assets = json.optJSONArray("assets") ?: JSONArray()
        Store(
            slug = store.getString("slug"),
            name = store.getString("name"),
            tagline = store.optString("tagline"),
            bannerUrl = store.optString("bannerUrl").takeIf { it.isNotBlank() },
            assets = (0 until assets.length()).map { assets.getJSONObject(it).toAsset() },
        )
    }

    /**
     * One asset, with URLs that only exist once there is an unlock.
     *
     * `streamUrl` and `downloadUrl` are minted per request for this account and
     * expire. They are the only way to the bytes; the storage key never leaves
     * the server.
     */
    suspend fun asset(assetId: String): AssetDetail = withContext(Dispatchers.IO) {
        val json = get("/api/content/$assetId")
        val asset = json.getJSONObject("asset")
        val files = json.optJSONArray("files") ?: JSONArray()
        val viewer = json.getJSONObject("viewer")
        val policy = json.getJSONObject("policy")
        val mark = json.getJSONObject("mark")

        AssetDetail(
            id = asset.getString("id"),
            title = asset.getString("title"),
            description = asset.optString("description"),
            coverUrl = asset.optString("coverUrl").takeIf { it.isNotBlank() },
            unlockMode = asset.getString("unlockMode"),
            storeSlug = asset.optJSONObject("channel")?.optString("slug").orEmpty(),
            locked = !viewer.optBoolean("unlocked", false),
            adsRequired = policy.optInt("adsRequired", 1),
            adMinSeconds = policy.optInt("adMinSeconds", 15),
            unlockHours = policy.optInt("unlockHours", 24),
            markLabel = mark.optString("label"),
            markOverlay = mark.optString("overlay"),
            files = (0 until files.length()).map { files.getJSONObject(it).toFile() },
        )
    }

    // ── unlocking ────────────────────────────────────────────────────────────

    /**
     * Ask the server to start a view, and get back what the network expects.
     *
     * The app never decides that an ad completed. The network tells the SERVER,
     * server to server; the app polls until the server says the unlock exists.
     * `devSimulator` is only present in a development build, and the sandbox
     * network it names has no account behind it.
     */
    suspend fun startUnlock(assetId: String): UnlockStart = withContext(Dispatchers.IO) {
        val json = postJson("/api/unlock/start", JSONObject().put("assetId", assetId))
        val cfg = json.optJSONObject("adConfig") ?: JSONObject()
        UnlockStart(
            viewId = json.optString("viewId"),
            alreadyUnlocked = json.optBoolean("alreadyUnlocked", false),
            providerId = cfg.optString("providerId"),
            connectionId = cfg.optString("connectionId"),
            minSeconds = cfg.optInt("minSeconds", 15),
            devSimulator = cfg.optBoolean("devSimulator", false),
        )
    }

    suspend fun unlockStatus(assetId: String, viewId: String): Boolean = withContext(Dispatchers.IO) {
        val json = get("/api/unlock/status?assetId=$assetId&viewId=$viewId")
        json.optBoolean("unlocked", false)
    }

    // ── media ────────────────────────────────────────────────────────────────

    /**
     * A media URL with the session cookie attached, for ExoPlayer.
     *
     * ExoPlayer needs headers it can send; passing the URL alone would 401, and
     * the token in the query string is not enough by itself — it was minted for
     * a signed-in account. Both go with every request, including each seek.
     */
    fun mediaUrl(path: String): String = url(path)

    fun cookieHeader(): String =
        cookies.loadForRequest(HttpUrl.get(url("/")))
            .joinToString("; ") { "${it.name}=${it.value}" }
}

// ── transport types ────────────────────────────────────────────────────────

class ApiException(val code: Int, override val message: String) : Exception(message)

data class Store(
    val slug: String,
    val name: String,
    val tagline: String,
    val bannerUrl: String?,
    val assets: List<StoreAsset>,
)

data class StoreAsset(
    val id: String,
    val title: String,
    val description: String,
    val coverUrl: String?,
    val kind: String,
    val fileCount: Int,
    val unlocked: Boolean,
    val adsRequired: Int,
)

data class AssetDetail(
    val id: String,
    val title: String,
    val description: String,
    val coverUrl: String?,
    val unlockMode: String,
    val storeSlug: String,
    val locked: Boolean,
    val adsRequired: Int,
    val adMinSeconds: Int,
    val unlockHours: Int,
    val markLabel: String,
    val markOverlay: String,
    val files: List<AssetFile>,
) {
    val playable: AssetFile? get() = files.firstOrNull { it.playable }
}

data class AssetFile(
    val id: String,
    val filename: String,
    val mimeType: String,
    val sizeBytes: Long,
    val kind: String,
    val playable: Boolean,
    val marked: Boolean,
    val streamUrl: String?,
    val downloadUrl: String?,
)

data class UnlockStart(
    val viewId: String,
    val alreadyUnlocked: Boolean,
    val providerId: String,
    val connectionId: String,
    val minSeconds: Int,
    val devSimulator: Boolean,
)

private fun JSONObject.toAsset() = StoreAsset(
    id = getString("id"),
    title = getString("title"),
    description = optString("description"),
    coverUrl = optString("coverUrl").takeIf { it.isNotBlank() },
    kind = optString("kind", "file"),
    fileCount = optInt("fileCount", 1),
    unlocked = optBoolean("unlocked", false),
    adsRequired = optInt("adsRequired", 1),
)

private fun JSONObject.toFile() = AssetFile(
    id = getString("id"),
    filename = getString("filename"),
    mimeType = optString("mimeType"),
    sizeBytes = optLong("sizeBytes", 0),
    kind = optString("kind", "file"),
    playable = optBoolean("playable", false),
    marked = optBoolean("marked", false),
    streamUrl = optString("streamUrl").takeIf { it.isNotBlank() },
    downloadUrl = optString("downloadUrl").takeIf { it.isNotBlank() },
)
