package com.bytebikri.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.bytebikri.app.network.ApiService
import com.bytebikri.app.network.StoreAsset
import kotlinx.coroutines.launch

/**
 * A storefront.
 *
 * Reads the same data the website's storefront reads, so the two cannot drift
 * into showing different things — and it shows the same two facts the web page
 * shows about access: how many ads, and whether it is already unlocked. There is
 * no price, because there is no price anywhere in this product.
 */
@Composable
fun StoreScreen(
    api: ApiService,
    storeSlug: String,
    onOpenAsset: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var assets by remember { mutableStateOf<List<StoreAsset>>(emptyList()) }
    var title by remember { mutableStateOf(storeSlug) }
    var tagline by remember { mutableStateOf("") }
    var banner by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(storeSlug) {
        loading = true
        runCatching { api.store(storeSlug) }
            .onSuccess {
                assets = it.assets
                title = it.name
                tagline = it.tagline
                banner = it.bannerUrl?.let { path -> api.mediaUrl(path) }
                error = null
            }
            .onFailure { error = it.message ?: "Could not load this store." }
        loading = false
    }

    Column(Modifier.fillMaxSize()) {
        if (banner != null) {
            AsyncImage(
                model = banner,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(120.dp),
            )
        }

        Column(Modifier.padding(horizontal = 16.dp, vertical = 16.dp)) {
            Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            if (tagline.isNotBlank()) {
                Text(
                    tagline,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }

        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }

            error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
                    Text(error!!, style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = { scope.launch { loading = true; error = null } }) { Text("Try again") }
                }
            }

            assets.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("This store has not published anything yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            else -> LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(assets, key = { it.id }) { asset ->
                    AssetRow(api, asset) { onOpenAsset(asset.id) }
                }
            }
        }
    }
}

@Composable
private fun AssetRow(api: ApiService, asset: StoreAsset, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (asset.coverUrl != null) {
                AsyncImage(
                    model = api.mediaUrl(asset.coverUrl),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .size(64.dp)
                        // One radius for every thumbnail in a list, so the rows
                        // line up instead of each looking hand-placed.
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surface),
                )
                Spacer(Modifier.width(12.dp))
            }

            Column(Modifier.weight(1f)) {
                Text(
                    asset.title,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    // "Video · plays here" is the honest label: a playable file is
                    // not offered as a download on any surface of this product.
                    buildString {
                        append(kindLabel(asset.kind))
                        append(" · ")
                        append(if (asset.kind == "video" || asset.kind == "audio") "plays here" else "download")
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(Modifier.width(8.dp))
            if (asset.unlocked) {
                AssistChip(onClick = onClick, label = { Text("Unlocked") })
            } else if (asset.adsRequired <= 0) {
                AssistChip(onClick = onClick, label = { Text("Free") })
            } else {
                AssistChip(
                    onClick = onClick,
                    label = { Text("${asset.adsRequired} ad" + if (asset.adsRequired == 1) "" else "s") },
                )
            }
        }
    }
}

private fun kindLabel(kind: String) = when (kind) {
    "video" -> "Video"
    "audio" -> "Audio"
    "image" -> "Image"
    else -> "File"
}
