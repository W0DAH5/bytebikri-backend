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
// ==================== HOME SCREEN ====================
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    userId: String,
    token: String,
    onNavigateToUpload: () -> Unit,
    onNavigateToWallet: () -> Unit,
    onNavigateToChannel: () -> Unit,
    onNavigateToAdmin: () -> Unit,
    onNavigateToSettings: () -> Unit,
    securityManager: SecurityManager
) {
    var assets by remember { mutableStateOf<List<Asset>>(emptyList()) }
    var coinBalance by remember { mutableStateOf(0) }
    var isLoading by remember { mutableStateOf(true) }
    
    val scope = rememberCoroutineScope()
    val apiService = remember { ApiService() }

    LaunchedEffect(Unit) {
        launch {
            apiService.fetchAssets(token).onSuccess { 
                assets = it 
            }
        }
        launch {
            apiService.getCoinBalance(userId, token).onSuccess { 
                coinBalance = it 
            }
        }
        isLoading = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("ByteBikri") },
                actions = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(horizontal = 8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Star,
                            contentDescription = "Coins",
                            tint = Color(0xFFFFD700)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "$coinBalance",
                            fontWeight = FontWeight.Bold
                        )
                        IconButton(onClick = onNavigateToWallet) {
                            Icon(Icons.Default.AccountBalanceWallet, "Wallet")
                        }
                        IconButton(onClick = onNavigateToSettings) {
                            Icon(Icons.Default.Settings, "Settings")
                        }
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onNavigateToUpload,
                containerColor = MaterialTheme.colorScheme.primary
            ) {
                Icon(Icons.Default.Upload, "Upload")
            }
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    icon = { Icon(Icons.Default.Home, "Home") },
                    label = { Text("Market") },
                    selected = true,
                    onClick = { }
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Default.VideoLibrary, "Channel") },
                    label = { Text("Channel") },
                    selected = false,
                    onClick = onNavigateToChannel
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Default.AdminPanelSettings, "Admin") },
                    label = { Text("Admin") },
                    selected = false,
                    onClick = onNavigateToAdmin
                )
            }
        }
    ) { padding ->
        if (isLoading) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                contentPadding = padding,
                modifier = Modifier.fillMaxSize(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(assets) { asset ->
                    AssetCard(
                        asset = asset,
                        onPurchase = {
                            scope.launch {
                                apiService.purchaseAsset(token, asset.id, asset.priceCoins)
                                    .onSuccess {
                                        apiService.fetchAssets(token).onSuccess { assets = it }
                                        apiService.getCoinBalance(userId, token).onSuccess { coinBalance = it }
                                    }
                            }
                        },
                        securityManager = securityManager
                    )
                }
            }
        }
    }
}

@Composable
fun AssetCard(
    asset: Asset,
    onPurchase: () -> Unit,
    securityManager: SecurityManager
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(4.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        Column {
            CachedAsyncImage(
                assetId = asset.id,
                url = asset.fileUrl,
                previewUrl = asset.previewUrl,
                contentDescription = asset.title,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(150.dp)
            )
            
            Column(modifier = Modifier.padding(8.dp)) {
                Text(
                    text = asset.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1
                )
                
                Spacer(modifier = Modifier.height(4.dp))
                
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.Star,
                            contentDescription = "Price",
                            tint = Color(0xFFFFD700),
                            modifier = Modifier.size(16.dp)
                        )
                        Text(
                            text = "${asset.priceCoins}",
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                    
                    if (asset.unlocked) {
                        Text(
                            text = "UNLOCKED",
                            color = Color(0xFF4CAF50),
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold
                        )
                    } else {
                        Button(
                            onClick = {
                                if (securityManager.checkSensitiveAction("purchase")) {
                                    onPurchase()
                                }
                            },
                            modifier = Modifier.height(32.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp)
                        ) {
                            Text("Unlock", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }
    }
}