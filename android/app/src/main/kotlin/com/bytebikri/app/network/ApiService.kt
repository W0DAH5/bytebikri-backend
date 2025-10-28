package com.bytebikri.app.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

class ApiService {
    companion object {
        // ⚠️ CHANGE THIS to your Replit URL after deployment
        private const val BASE_URL = "https://your-replit-url.repl.co"
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    suspend fun signup(email: String, password: String): Result<AuthResponse> {
        return withContext(Dispatchers.IO) {
            try {
                val json = JSONObject().apply {
                    put("email", email)
                    put("password", password)
                }

                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$BASE_URL/api/signup")
                    .post(body)
                    .build()

                client.newCall(request).execute().use { response ->
                    val responseBody = response.body?.string() ?: ""
                    val jsonResponse = JSONObject(responseBody)

                    if (response.isSuccessful && jsonResponse.optBoolean("ok", false)) {
                        Result.success(
                            AuthResponse(
                                success = true,
                                userId = jsonResponse.optJSONObject("user")?.optString("id") ?: "",
                                token = jsonResponse.optString("token", ""),
                                message = "Signup successful"
                            )
                        )
                    } else {
                        Result.failure(Exception(jsonResponse.optString("error", "Signup failed")))
                    }
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    suspend fun signin(email: String, password: String): Result<AuthResponse> {
        return withContext(Dispatchers.IO) {
            try {
                val json = JSONObject().apply {
                    put("email", email)
                    put("password", password)
                }

                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$BASE_URL/api/signin")
                    .post(body)
                    .build()

                client.newCall(request).execute().use { response ->
                    val responseBody = response.body?.string() ?: ""
                    val jsonResponse = JSONObject(responseBody)

                    if (response.isSuccessful && jsonResponse.optBoolean("ok", false)) {
                        val userObj = jsonResponse.optJSONObject("user")
                        Result.success(
                            AuthResponse(
                                success = true,
                                userId = userObj?.optString("id") ?: "",
                                token = jsonResponse.optString("token", ""),
                                role = userObj?.optString("role", "user") ?: "user",
                                message = "Login successful"
                            )
                        )
                    } else {
                        Result.failure(Exception(jsonResponse.optString("error", "Login failed")))
                    }
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    suspend fun fetchAssets(token: String): Result<List<Asset>> {
        return withContext(Dispatchers.IO) {
            try {
                val request = Request.Builder()
                    .url("$BASE_URL/api/assets")
                    .header("x-auth-token", token)
                    .get()
                    .build()

                client.newCall(request).execute().use { response ->
                    val responseBody = response.body?.string() ?: "[]"
                    val jsonArray = JSONArray(responseBody)
                    
                    val assets = mutableListOf<Asset>()
                    for (i in 0 until jsonArray.length()) {
                        val obj = jsonArray.getJSONObject(i)
                        assets.add(
                            Asset(
                                id = obj.getString("id"),
                                ownerId = obj.getString("owner_id"),
                                title = obj.getString("title"),
                                priceCoins = obj.getInt("price_coins"),
                                fileUrl = obj.getString("file_url"),
                                previewUrl = obj.getString("preview_url"),
                                type = obj.optString("type", "small"),
                                unlocked = obj.optBoolean("unlocked", false),
                                flagged = obj.optBoolean("flagged", false)
                            )
                        )
                    }
                    Result.success(assets)
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    suspend fun uploadAsset(
        token: String,
        file: File,
        title: String,
        priceCoins: Int
    ): Result<Asset> {
        return withContext(Dispatchers.IO) {
            try {
                val requestBody = MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart(
                        "file",
                        file.name,
                        file.asRequestBody("application/octet-stream".toMediaType())
                    )
                    .addFormDataPart("title", title)
                    .addFormDataPart("price_coins", priceCoins.toString())
                    .build()

                val request = Request.Builder()
                    .url("$BASE_URL/api/upload")
                    .header("x-auth-token", token)
                    .post(requestBody)
                    .build()

                client.newCall(request).execute().use { response ->
                    val responseBody = response.body?.string() ?: ""
                    val jsonResponse = JSONObject(responseBody)

                    if (response.isSuccessful && jsonResponse.optBoolean("ok", false)) {
                        val assetObj = jsonResponse.getJSONObject("asset")
                        Result.success(
                            Asset(
                                id = assetObj.getString("id"),
                                ownerId = assetObj.getString("owner_id"),
                                title = assetObj.getString("title"),
                                priceCoins = assetObj.getInt("price_coins"),
                                fileUrl = assetObj.getString("file_url"),
                                previewUrl = assetObj.getString("preview_url"),
                                type = assetObj.optString("type", "small"),
                                unlocked = false,
                                flagged = false
                            )
                        )
                    } else {
                        Result.failure(Exception(jsonResponse.optString("error", "Upload failed")))
                    }
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    suspend fun getCoinBalance(userId: String, token: String): Result<Int> {
        return withContext(Dispatchers.IO) {
            try {
                val request = Request.Builder()
                    .url("$BASE_URL/api/coins/$userId")
                    .header("x-auth-token", token)
                    .get()
                    .build()

                client.newCall(request).execute().use { response ->
                    val responseBody = response.body?.string() ?: ""
                    val jsonResponse = JSONObject(responseBody)

                    if (response.isSuccessful) {
                        Result.success(jsonResponse.optInt("balance", 0))
                    } else {
                        Result.failure(Exception(jsonResponse.optString("error", "Failed to fetch balance")))
                    }
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    suspend fun purchaseAsset(
        token: String,
        assetId: String,
        coins: Int
    ): Result<PurchaseResponse> {
        return withContext(Dispatchers.IO) {
            try {
                val json = JSONObject().apply {
                    put("assetId", assetId)
                    put("coins", coins)
                }

                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$BASE_URL/api/spend")
                    .header("x-auth-token", token)
                    .post(body)
                    .build()

                client.newCall(request).execute().use { response ->
                    val responseBody = response.body?.string() ?: ""
                    val jsonResponse = JSONObject(responseBody)

                    if (response.isSuccessful && jsonResponse.optBoolean("ok", false)) {
                        Result.success(
                            PurchaseResponse(
                                success = true,
                                bonus = jsonResponse.optInt("bonus", 0),
                                message = "Purchase successful"
                            )
                        )
                    } else {
                        Result.failure(Exception(jsonResponse.optString("error", "Purchase failed")))
                    }
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    suspend fun fetchFlaggedAssets(token: String): Result<List<Asset>> {
        return withContext(Dispatchers.IO) {
            try {
                val request = Request.Builder()
                    .url("$BASE_URL/api/admin/flagged")
                    .header("x-auth-token", token)
                    .get()
                    .build()

                client.newCall(request).execute().use { response ->
                    val responseBody = response.body?.string() ?: ""
                    val jsonResponse = JSONObject(responseBody)
                    val jsonArray = jsonResponse.optJSONArray("assets") ?: JSONArray()
                    
                    val assets = mutableListOf<Asset>()
                    for (i in 0 until jsonArray.length()) {
                        val obj = jsonArray.getJSONObject(i)
                        assets.add(
                            Asset(
                                id = obj.getString("id"),
                                ownerId = obj.getString("owner_id"),
                                title = obj.getString("title"),
                                priceCoins = obj.getInt("price_coins"),
                                fileUrl = obj.getString("file_url"),
                                previewUrl = obj.getString("preview_url"),
                                type = obj.optString("type", "small"),
                                unlocked = false,
                                flagged = true
                            )
                        )
                    }
                    Result.success(assets)
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    suspend fun banUser(token: String, userId: String): Result<Boolean> {
        return withContext(Dispatchers.IO) {
            try {
                val json = JSONObject().apply {
                    put("userId", userId)
                }

                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$BASE_URL/api/admin/ban")
                    .header("x-auth-token", token)
                    .post(body)
                    .build()

                client.newCall(request).execute().use { response ->
                    val responseBody = response.body?.string() ?: ""
                    val jsonResponse = JSONObject(responseBody)

                    if (response.isSuccessful && jsonResponse.optBoolean("ok", false)) {
                        Result.success(true)
                    } else {
                        Result.failure(Exception(jsonResponse.optString("error", "Ban failed")))
                    }
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    suspend fun unflagAsset(token: String, assetId: String): Result<Boolean> {
        return withContext(Dispatchers.IO) {
            try {
                val json = JSONObject().apply {
                    put("assetId", assetId)
                }

                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$BASE_URL/api/admin/unflag")
                    .header("x-auth-token", token)
                    .post(body)
                    .build()

                client.newCall(request).execute().use { response ->
                    val responseBody = response.body?.string() ?: ""
                    val jsonResponse = JSONObject(responseBody)

                    if (response.isSuccessful && jsonResponse.optBoolean("ok", false)) {
                        Result.success(true)
                    } else {
                        Result.failure(Exception(jsonResponse.optString("error", "Unflag failed")))
                    }
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
}

data class AuthResponse(
    val success: Boolean,
    val userId: String = "",
    val token: String = "",
    val role: String = "user",
    val message: String = ""
)

data class Asset(
    val id: String,
    val ownerId: String,
    val title: String,
    val priceCoins: Int,
    val fileUrl: String,
    val previewUrl: String,
    val type: String,
    val unlocked: Boolean,
    val flagged: Boolean
)

data class PurchaseResponse(
    val success: Boolean,
    val bonus: Int = 0,
    val message: String = ""
)