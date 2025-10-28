package com.bytebikri.app

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.*
import com.bytebikri.app.security.SecurityManager
import com.bytebikri.app.ui.theme.ByteBikriTheme
import com.bytebikri.app.ui.screens.*

class MainActivity : ComponentActivity() {
    private lateinit var securityManager: SecurityManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        securityManager = SecurityManager(this)
        
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )
        
        if (securityManager.isAppBlocked()) {
            setContent {
                ByteBikriTheme {
                    BlockedScreen()
                }
            }
            return
        }

        setContent {
            ByteBikriTheme {
                ByteBikriApp(securityManager)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        securityManager.checkScreenRecording()
    }
}

@Composable
fun ByteBikriApp(securityManager: SecurityManager) {
    val navController = rememberNavController()
    
    NavHost(navController = navController, startDestination = "login") {
        composable("login") { 
            LoginScreen(
                onLoginSuccess = { userId, token ->
                    navController.navigate("home/$userId/$token") {
                        popUpTo("login") { inclusive = true }
                    }
                },
                securityManager = securityManager
            )
        }
        composable("home/{userId}/{token}") { backStackEntry ->
            val userId = backStackEntry.arguments?.getString("userId") ?: ""
            val token = backStackEntry.arguments?.getString("token") ?: ""
            
            HomeScreen(
                userId = userId,
                token = token,
                onNavigateToUpload = { navController.navigate("upload/$userId/$token") },
                onNavigateToWallet = { navController.navigate("wallet/$userId/$token") },
                onNavigateToChannel = { navController.navigate("channel/$userId/$token") },
                onNavigateToAdmin = { navController.navigate("admin/$token") },
                onNavigateToSettings = { navController.navigate("settings/$userId/$token") },
                securityManager = securityManager
            )
        }
        composable("upload/{userId}/{token}") { backStackEntry ->
            val userId = backStackEntry.arguments?.getString("userId") ?: ""
            val token = backStackEntry.arguments?.getString("token") ?: ""
            
            UploadScreen(
                userId = userId,
                token = token,
                onBack = { navController.popBackStack() },
                securityManager = securityManager
            )
        }
        composable("wallet/{userId}/{token}") { backStackEntry ->
            val userId = backStackEntry.arguments?.getString("userId") ?: ""
            val token = backStackEntry.arguments?.getString("token") ?: ""
            
            WalletScreen(
                userId = userId,
                token = token,
                onBack = { navController.popBackStack() },
                securityManager = securityManager
            )
        }
        composable("channel/{userId}/{token}") { backStackEntry ->
            val userId = backStackEntry.arguments?.getString("userId") ?: ""
            val token = backStackEntry.arguments?.getString("token") ?: ""
            
            ChannelScreen(
                userId = userId,
                token = token,
                onBack = { navController.popBackStack() },
                securityManager = securityManager
            )
        }
        composable("admin/{token}") { backStackEntry ->
            val token = backStackEntry.arguments?.getString("token") ?: ""
            
            AdminScreen(
                token = token,
                onBack = { navController.popBackStack() },
                securityManager = securityManager
            )
        }
        composable("settings/{userId}/{token}") { backStackEntry ->
            val userId = backStackEntry.arguments?.getString("userId") ?: ""
            val token = backStackEntry.arguments?.getString("token") ?: ""
            
            SettingsScreen(
                userId = userId,
                token = token,
                onBack = { navController.popBackStack() }
            )
        }
    }
}

@Composable
fun BlockedScreen() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = "App Blocked",
                style = MaterialTheme.typography.headlineMedium,
                color = Color.Red
            )
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "Suspicious activity detected.\nContact administrator.",
                style = MaterialTheme.typography.bodyLarge,
                color = Color.White
            )
        }
    }
}