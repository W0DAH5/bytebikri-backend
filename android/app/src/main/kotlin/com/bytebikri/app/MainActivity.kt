package com.bytebikri.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.bytebikri.app.network.ApiService
import com.bytebikri.app.security.SecurityManager
import com.bytebikri.app.ui.screens.AssetScreen
import com.bytebikri.app.ui.screens.LoginScreen
import com.bytebikri.app.ui.screens.StoreScreen
import com.bytebikri.app.ui.theme.ByteBikriTheme

/**
 * Three destinations: sign in, a store, an asset.
 *
 * That is the whole app, and the whole product in the app: the ad pays the
 * creator, the unlock is written by the server, the file plays. There is no
 * wallet screen because there is no wallet; no buy button because there is no
 * price; no admin screen because moderation is the operator's job on the server,
 * not a ban button on a phone.
 *
 * `FLAG_SECURE` is set before any content renders — on this window and on the
 * asset screen — so screenshots and OS-level screen recording of locked content
 * come out black. It is the one real protection in this module, and it is
 * enforced by Android rather than promised by us.
 */
class MainActivity : ComponentActivity() {

    private lateinit var securityManager: SecurityManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        securityManager = SecurityManager(this)
        securityManager.protect()

        // Where the server is. Debug builds point at the host machine as seen
        // from the emulator; a release build cannot be shipped with a placeholder
        // that silently fails at runtime, so the build fails instead.
        val baseUrl = BuildConfig.BASE_URL
        require(baseUrl.startsWith("https://") || BuildConfig.DEBUG) {
            "BASE_URL must be https in a release build"
        }

        setContent {
            ByteBikriTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    ByteBikriApp(baseUrl)
                }
            }
        }
    }
}

@Composable
private fun ByteBikriApp(baseUrl: String) {
    val navController = rememberNavController()
    val api = remember { ApiService(baseUrl) }

    // The Activity itself, because FLAG_SECURE and the screenshot callback are
    // per-window: a manager built from the application context cannot protect
    // anything.
    val activity = LocalContext.current as ComponentActivity
    val security = remember(activity) { SecurityManager(activity) }

    NavHost(navController = navController, startDestination = "login") {
        composable("login") {
            LoginScreen(
                api = api,
                defaultStore = DEMO_STORE,
                onSignedIn = { navController.navigate("store/$DEMO_STORE") },
                onBrowse = { navController.navigate("store/$DEMO_STORE") },
            )
        }
        composable("store/{slug}") { entry ->
            val slug = entry.arguments?.getString("slug") ?: DEMO_STORE
            StoreScreen(
                api = api,
                storeSlug = slug,
                onOpenAsset = { assetId -> navController.navigate("asset/$assetId") },
            )
        }
        composable("asset/{assetId}") { entry ->
            val assetId = entry.arguments?.getString("assetId").orEmpty()
            AssetScreen(
                api = api,
                assetId = assetId,
                securityManager = security,
                onBack = { navController.popBackStack() },
            )
        }
    }
}

/** The store a fresh install opens. One slug, not a directory listing. */
private const val DEMO_STORE = "alice"
