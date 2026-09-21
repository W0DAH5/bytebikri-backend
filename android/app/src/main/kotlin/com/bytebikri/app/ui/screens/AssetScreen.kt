package com.bytebikri.app.ui.screens

import android.view.ViewGroup
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import com.bytebikri.app.network.ApiService
import com.bytebikri.app.network.AssetDetail
import com.bytebikri.app.security.SecurityManager
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * One asset: play it, or unlock it.
 *
 * The player is the point of this screen. A video is played, not handed over —
 * there is no download button, `PlayerView` is given no controller that offers
 * one, and the media never touches the disk (no `SimpleCache`, so "offline
 * copy" is not a feature that can be turned into a leak).
 *
 * What the screen does NOT claim: that the content cannot be captured. A screen
 * recorder records any app. `FLAG_SECURE` stops screenshots and OS screen
 * recording of this window — which is a genuine block, and a different thing
 * from a promise. The watermark label is drawn over playback so that whatever
 * escapes is traceable to the account that played it, and the copy under the
 * player says exactly that, in those words.
 */
@OptIn(UnstableApi::class)
@Composable
fun AssetScreen(
    api: ApiService,
    assetId: String,
    securityManager: SecurityManager,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<AssetDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }
    var screenshotTaken by remember { mutableStateOf(false) }

    // Every window that shows locked content is protected, not just the activity.
    SideEffect { securityManager.protect() }

    // Reports a screenshot on Android 14+. Nothing punitive happens: the user
    // screenshotted something they unlocked, and the file carries their reference
    // either way. Killing their session over it would be theatre.
    DisposableEffect(Unit) {
        val handle = securityManager.watchForScreenshots { screenshotTaken = true }
        onDispose { handle?.close() }
    }

    suspend fun reload() {
        runCatching { api.asset(assetId) }
            .onSuccess { detail = it; error = null }
            .onFailure { error = it.message ?: "Could not load this asset." }
    }

    LaunchedEffect(assetId) { reload() }

    val player = remember {
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(
                DefaultMediaSourceFactory(
                    DefaultHttpDataSource.Factory().setDefaultRequestProperties(
                        // The token in the URL is not enough: the route also
                        // checks the session, and the token only works for the
                        // account it was minted for. Both travel together.
                        mapOf("Cookie" to api.cookieHeader()),
                    ),
                ),
            )
            .build()
    }
    DisposableEffect(Unit) { onDispose { player.release() } }

    val playable = detail?.playable
    LaunchedEffect(playable?.streamUrl) {
        val src = playable?.streamUrl ?: return@LaunchedEffect
        player.setMediaItem(MediaItem.fromUri(api.mediaUrl(src)))
        player.prepare()
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Row(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onBack) { Text("← Back") }
            Spacer(Modifier.weight(1f))
            detail?.let {
                AssistChip(
                    onClick = {},
                    label = { Text(if (it.locked) "Locked" else "Unlocked") },
                )
            }
        }

        when {
            error != null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                Text(error!!)
            }

            detail == null -> Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }

            else -> {
                val d = detail!!
                Box(
                    Modifier
                        .fillMaxWidth()
                        .background(Color.Black),
                ) {
                    if (d.locked || playable?.streamUrl == null) {
                        if (d.coverUrl != null) {
                            AsyncImage(
                                model = api.mediaUrl(d.coverUrl),
                                contentDescription = null,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f),
                            )
                        } else {
                            Spacer(Modifier.fillMaxWidth().aspectRatio(16f / 9f))
                        }
                    } else {
                        AndroidView(
                            factory = { ctx ->
                                PlayerView(ctx).apply {
                                    this.player = player
                                    useController = true
                                    // No download, no picture-in-picture controls, no
                                    // playback-rate menu: every one of those is an
                                    // export path this screen does not offer.
                                    setShowNextButton(false)
                                    setShowPreviousButton(false)
                                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                                    layoutParams = ViewGroup.LayoutParams(
                                        ViewGroup.LayoutParams.MATCH_PARENT,
                                        ViewGroup.LayoutParams.MATCH_PARENT,
                                    )
                                }
                            },
                            modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f),
                        )
                    }

                    // The mark, drawn over the frames exactly as the web page
                    // draws it — the same account reference either way, so a
                    // recording from the app and one from the browser are
                    // traceable to the same account.
                    if (!d.locked && d.markLabel.isNotBlank()) {
                        Text(
                            d.markLabel,
                            color = Color.White.copy(alpha = 0.30f),
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier
                                .align(Alignment.TopStart)
                                .padding(8.dp),
                        )
                        Text(
                            d.markLabel,
                            color = Color.White.copy(alpha = 0.30f),
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier
                                .align(Alignment.BottomEnd)
                                .padding(8.dp),
                        )
                    }
                }

                Column(Modifier.padding(16.dp)) {
                    Text(d.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                    if (d.description.isNotBlank()) {
                        Text(
                            d.description,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    }

                    Spacer(Modifier.height(16.dp))

                    if (d.locked) {
                        Button(
                            enabled = !busy,
                            onClick = {
                                busy = true
                                status = "Starting…"
                                // The app asks the server to start a view and then
                                // waits. It never grants itself anything: the
                                // network tells the server, and the server is the
                                // only thing that can write an unlock.
                                scope.launch {
                                    val unlocked = awaitUnlock(api, d) { status = it }
                                    busy = false
                                    if (unlocked) reload()
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                if (d.adsRequired == 1) "Watch 1 ad to unlock"
                                else "Watch ${d.adsRequired} ads to unlock",
                            )
                        }
                        Text(
                            "About ${d.adMinSeconds} seconds. The unlock is granted only when the ad " +
                                "network confirms server-to-server that the view completed.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                        status?.let {
                            Text(
                                it,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                        }
                    } else {
                        d.files.forEach { file ->
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(file.filename, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                                AssistChip(
                                    onClick = {},
                                    label = {
                                        Text(
                                            when {
                                                file.playable -> "Plays here"
                                                file.marked -> "Watermarked"
                                                else -> "Download"
                                            },
                                        )
                                    },
                                )
                            }
                        }
                    }

                    Spacer(Modifier.height(16.dp))
                    Text(
                        // The honest paragraph. Every claim in it is one the
                        // platform actually supports.
                        "Screenshots and screen recording of this window are blocked by the " +
                            "operating system while playback is open. A copy made with an outside " +
                            "camera cannot be prevented by anyone, so this screen also draws your " +
                            "account reference over the video: a recording is traceable to the " +
                            "account that played it." +
                            if (screenshotTaken) "\n\nA screenshot was detected. Your reference is on it." else "",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/**
 * Start a view, then wait until the server says it counted.
 *
 * Kept out of the composable body so the polling is not cancelled by a
 * recomposition — an unlock that stops being awaited halfway is an unlock the
 * user never gets, and it looks exactly like the ad failing.
 */
private suspend fun awaitUnlock(
    api: ApiService,
    detail: AssetDetail,
    onStatus: (String) -> Unit,
): Boolean {
    val start = runCatching { api.startUnlock(detail.id) }.getOrElse {
        onStatus("Could not start: ${it.message}")
        return false
    }
    if (start.alreadyUnlocked) return true

    onStatus("Waiting for ${start.providerId} to confirm…")

    // Providers reconcile asynchronously, so this waits rather than declaring
    // failure the moment the countdown ends.
    val deadline = System.currentTimeMillis() + 90_000
    while (System.currentTimeMillis() < deadline) {
        delay(1500)
        if (runCatching { api.unlockStatus(detail.id, start.viewId) }.getOrDefault(false)) {
            onStatus("Unlocked.")
            return true
        }
    }
    onStatus("The network has not confirmed yet. Open this asset again in a moment.")
    return false
}
