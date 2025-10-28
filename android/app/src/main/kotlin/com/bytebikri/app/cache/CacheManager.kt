package com.bytebikri.app.cache

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

class CacheManager(private val context: Context) {
    
    companion object {
        private const val MEMORY_CACHE_SIZE = 50 * 1024 * 1024
        private const val DISK_CACHE_SIZE = 500L * 1024 * 1024
        private const val PREVIEW_CACHE_DIR = "preview_cache"
        private const val MEDIA_CACHE_DIR = "media_cache"
        private const val TEMP_CACHE_DIR = "temp_cache"
        
        @Volatile
        private var instance: CacheManager? = null
        
        fun getInstance(context: Context): CacheManager {
            return instance ?: synchronized(this) {
                instance ?: CacheManager(context.applicationContext).also { instance = it }
            }
        }
    }
    
    private val memoryCache = object : LruCache<String, Bitmap>(MEMORY_CACHE_SIZE) {
        override fun sizeOf(key: String, bitmap: Bitmap): Int {
            return bitmap.byteCount
        }
    }
    
    private val pathCache = mutableMapOf<String, String>()
    private val client = OkHttpClient.Builder().build()
    
    private val previewCacheDir = File(context.cacheDir, PREVIEW_CACHE_DIR).apply { mkdirs() }
    private val mediaCacheDir = File(context.filesDir, MEDIA_CACHE_DIR).apply { mkdirs() }
    private val tempCacheDir = File(context.cacheDir, TEMP_CACHE_DIR).apply { mkdirs() }
    
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    suspend fun getCachedMedia(
        assetId: String,
        url: String,
        isPreview: Boolean = false,
        onProgress: ((progress: Int) -> Unit)? = null
    ): CachedMedia = withContext(Dispatchers.IO) {
        
        val cacheKey = generateCacheKey(url)
        val cacheDir = if (isPreview) previewCacheDir else mediaCacheDir
        val cachedFile = File(cacheDir, cacheKey)
        
        if (cachedFile.exists()) {
            pathCache[cacheKey] = cachedFile.absolutePath
            return@withContext CachedMedia(
                path = cachedFile.absolutePath,
                isCached = true,
                size = cachedFile.length()
            )
        }
        
        try {
            val request = Request.Builder().url(url).build()
            val response = client.newCall(request).execute()
            
            if (!response.isSuccessful) {
                throw Exception("Download failed: ${response.code}")
            }
            
            val body = response.body ?: throw Exception("Empty response body")
            val contentLength = body.contentLength()
            
            val tempFile = File(tempCacheDir, "$cacheKey.tmp")
            FileOutputStream(tempFile).use { output ->
                body.byteStream().use { input ->
                    val buffer = ByteArray(8192)
                    var bytesRead: Int
                    var totalBytesRead = 0L
                    
                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        output.write(buffer, 0, bytesRead)
                        totalBytesRead += bytesRead
                        
                        if (contentLength > 0) {
                            val progress = (totalBytesRead * 100 / contentLength).toInt()
                            withContext(Dispatchers.Main) {
                                onProgress?.invoke(progress)
                            }
                        }
                    }
                }
            }
            
            if (tempFile.renameTo(cachedFile)) {
                pathCache[cacheKey] = cachedFile.absolutePath
                
                if (isPreview) {
                    loadBitmapToMemoryCache(cacheKey, cachedFile)
                }
                
                return@withContext CachedMedia(
                    path = cachedFile.absolutePath,
                    isCached = true,
                    size = cachedFile.length()
                )
            } else {
                throw Exception("Failed to move file to cache")
            }
            
        } catch (e: Exception) {
            e.printStackTrace()
            return@withContext CachedMedia(
                path = null,
                isCached = false,
                size = 0,
                error = e.message
            )
        }
    }
    
    fun getCachedBitmap(url: String): Bitmap? {
        val cacheKey = generateCacheKey(url)
        
        memoryCache.get(cacheKey)?.let { return it }
        
        pathCache[cacheKey]?.let { path ->
            val file = File(path)
            if (file.exists()) {
                return BitmapFactory.decodeFile(path)?.also { bitmap ->
                    memoryCache.put(cacheKey, bitmap)
                }
            }
        }
        
        return null
    }
    
    fun prefetchMedia(assetId: String, previewUrl: String, fullUrl: String) {
        scope.launch {
            getCachedMedia(assetId, previewUrl, isPreview = true)
            delay(500)
            getCachedMedia(assetId, fullUrl, isPreview = false)
        }
    }
    
    fun isCached(url: String): Boolean {
        val cacheKey = generateCacheKey(url)
        
        if (memoryCache.get(cacheKey) != null) return true
        
        pathCache[cacheKey]?.let { path ->
            return File(path).exists()
        }
        
        val previewFile = File(previewCacheDir, cacheKey)
        val mediaFile = File(mediaCacheDir, cacheKey)
        
        return previewFile.exists() || mediaFile.exists()
    }
    
    fun getCacheSize(): CacheSize {
        var previewSize = 0L
        var mediaSize = 0L
        
        previewCacheDir.listFiles()?.forEach { previewSize += it.length() }
        mediaCacheDir.listFiles()?.forEach { mediaSize += it.length() }
        
        return CacheSize(
            previewSize = previewSize,
            mediaSize = mediaSize,
            totalSize = previewSize + mediaSize,
            fileCount = (previewCacheDir.listFiles()?.size ?: 0) + 
                       (mediaCacheDir.listFiles()?.size ?: 0)
        )
    }
    
    fun clearAllCache() {
        memoryCache.evictAll()
        pathCache.clear()
        
        previewCacheDir.listFiles()?.forEach { it.delete() }
        mediaCacheDir.listFiles()?.forEach { it.delete() }
        tempCacheDir.listFiles()?.forEach { it.delete() }
    }
    
    fun clearPreviewCache() {
        previewCacheDir.listFiles()?.forEach { file ->
            val cacheKey = file.name
            memoryCache.remove(cacheKey)
            pathCache.remove(cacheKey)
            file.delete()
        }
    }
    
    private fun loadBitmapToMemoryCache(cacheKey: String, file: File) {
        try {
            val bitmap = BitmapFactory.decodeFile(file.absolutePath)
            if (bitmap != null) {
                memoryCache.put(cacheKey, bitmap)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
    
    private fun generateCacheKey(url: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(url.toByteArray())
        return hash.joinToString("") { "%02x".format(it) }
    }
}

data class CachedMedia(
    val path: String?,
    val isCached: Boolean,
    val size: Long,
    val error: String? = null
)

data class CacheSize(
    val previewSize: Long,
    val mediaSize: Long,
    val totalSize: Long,
    val fileCount: Int
) {
    fun getTotalSizeMB(): Float = totalSize / (1024f * 1024f)
    fun getPreviewSizeMB(): Float = previewSize / (1024f * 1024f)
    fun getMediaSizeMB(): Float = mediaSize / (1024f * 1024f)
}