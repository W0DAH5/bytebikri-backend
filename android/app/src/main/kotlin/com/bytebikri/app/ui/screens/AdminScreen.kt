package com.bytebikri.app.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.bytebikri.app.cache.CacheManager
import com.bytebikri.app.network.*
import com.bytebikri.app.security.SecurityManager
import com.bytebikri.app.ui.components.CachedAsyncImage
import kotlinx.coroutines.launch
import java.io.File
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminScreen(
    token: String,
    onBack: () -> Unit,
    securityManager: SecurityManager
) {
    var flaggedAssets by remember { mutableStateOf<List<Asset>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    
    val scope = rememberCoroutineScope()
    val apiService = remember { ApiService() }

    LaunchedEffect(Unit) {
        launch {
            apiService.fetchFlaggedAssets(token).onSuccess { 
                flaggedAssets = it 
            }
        }
        isLoading = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Admin Panel") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFFD32F2F)
                )
            )
        }
    ) { padding ->
        if (isLoading) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else if (flaggedAssets.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Text("No flagged assets")
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(flaggedAssets) { asset ->
                    FlaggedAssetCard(
                        asset = asset,
                        onBanUser = {
                            scope.launch {
                                apiService.banUser(token, asset.ownerId).onSuccess {
                                    apiService.fetchFlaggedAssets(token).onSuccess {
                                        flaggedAssets = it
                                    }
                                }
                            }
                        },
                        onUnflag = {
                            scope.launch {
                                apiService.unflagAsset(token, asset.id).onSuccess {
                                    apiService.fetchFlaggedAssets(token).onSuccess {
                                        flaggedAssets = it
                                    }
                                }
                            }
                        }
                    )
                }
            }
        }
    }
}

@Composable
fun FlaggedAssetCard(
    asset: Asset,
    onBanUser: () -> Unit,
    onUnflag: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = Color(0xFFFFEBEE)
        )
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CachedAsyncImage(
                    assetId = asset.id,
                    url = asset.previewUrl,
                    previewUrl = asset.previewUrl,
                    contentDescription = asset.title,
                    modifier = Modifier
                        .size(80.dp)
                        .clip(RoundedCornerShape(8.dp))
                )
                
                Spacer(modifier = Modifier.width(12.dp))
                
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = asset.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "Owner: ${asset.ownerId.take(8)}...",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.Gray
                    )
                    Text(
                        text = "Price: ${asset.priceCoins} coins",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
            
            Spacer(modifier = Modifier.height(8.dp))
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = onBanUser,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFD32F2F)
                    ),
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Block, "Ban", modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Ban User")
                }
                
                Button(
                    onClick = onUnflag,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF4CAF50)
                    ),
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.CheckCircle, "Unflag", modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Unflag")
                }
            }
        }
    }
}