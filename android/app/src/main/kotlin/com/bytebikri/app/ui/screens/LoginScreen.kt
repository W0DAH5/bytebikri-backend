package com.bytebikri.app.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.bytebikri.app.network.ApiService
import kotlinx.coroutines.launch

/**
 * Sign in, or look around without an account.
 *
 * Unlocking needs an account — an entitlement that is not tied to anyone cannot
 * be revoked, and a leak cannot be traced — but browsing does not. So the store
 * is reachable before anyone signs in, which is also what stops this screen from
 * being the first thing a new user sees.
 *
 * Signing in posts the website's own form. One authentication path, one set of
 * lockout rules, one audit trail; the alternative is a second login endpoint
 * written for the app and tested less.
 */
@Composable
fun LoginScreen(
    api: ApiService,
    defaultStore: String,
    onSignedIn: () -> Unit,
    onBrowse: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("ByteBikri", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(
            "Watch a short ad. Unlock the file.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp, bottom = 24.dp),
        )

        OutlinedTextField(
            value = email,
            onValueChange = { email = it; error = null },
            label = { Text("Email") },
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it; error = null },
            label = { Text("Password") },
            singleLine = true,
            enabled = !busy,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )

        error?.let {
            Text(
                it,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 8.dp),
            )
        }

        Spacer(Modifier.height(20.dp))
        Button(
            enabled = !busy && email.isNotBlank() && password.isNotBlank(),
            onClick = {
                busy = true
                error = null
                scope.launch {
                    runCatching { api.signIn(email.trim(), password) }
                        .onSuccess { onSignedIn() }
                        .onFailure { error = it.message ?: "Could not sign in." }
                    busy = false
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (busy) "Signing in…" else "Sign in")
        }

        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onBrowse, enabled = !busy) {
            Text("Browse $defaultStore without an account")
        }
    }
}
