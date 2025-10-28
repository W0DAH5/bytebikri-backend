package com.bytebikri.app.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.bytebikri.app.cache.CacheManager
import kotlinx.coroutines.launch

@Composable
fun CachedAsyncImage(
    assetId: String,
    url: String,
    previewUrl: String? = null,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop
) {
    val context = LocalContext.current
    val cacheManager = remember { CacheManager.getInstance(context) }
    
    var bitmap by remember { mutableStateOf(cacheManager.getCachedBitmap(previewUrl ?: url)) }
    var isLoading by remember { mutableStateOf(bitmap == null) }
    var progress by remember { mutableStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    
    val scope = rememberCoroutineScope()
    
    LaunchedEffect(url) {
        val cached = cacheManager.getCachedBitmap(url)
        if (cached != null) {
            bitmap = cached
            isLoading = false
            return@LaunchedEffect
        }
        
        previewUrl?.let { preview ->
            val previewCached = cacheManager.getCachedMedia(
                assetId = assetId,
                url = preview,
                isPreview = true
            )
            if (previewCached.isCached && previewCached.path != null) {
                val previewBitmap = cacheManager.getCachedBitmap(preview)
                if (previewBitmap != null) {
                    bitmap = previewBitmap
                }
            }
        }
        
        scope.launch {
            val result = cacheManager.getCachedMedia(
                assetId = assetId,
                url = url,
                isPreview = false,
                onProgress = { progress = it }
            )
            
            if (result.isCached && result.path != null) {
                bitmap = cacheManager.getCachedBitmap(url)
                isLoading = false
            } else {
                error = result.error
                isLoading = false
            }
        }
    }
    
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap!!.asImageBitmap(),
                contentDescription = contentDescription,
                modifier = Modifier.fillMaxSize(),
                contentScale = contentScale
            )
        } else if (isLoading) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
                modifier = Modifier.fillMaxSize()
            ) {
                CircularProgressIndicator()
                if (progress > 0) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(text = "$progress%", color = Color.White)
                }
            }
        } else if (error != null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Gray),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "Failed to load",
                    color = Color.White
                )
            }
        }
    }
}