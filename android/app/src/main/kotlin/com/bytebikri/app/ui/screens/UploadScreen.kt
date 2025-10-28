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
// ==================== UPLOAD SCREEN ====================
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UploadScreen(
    userId: String,
    token: String,
    onBack: () -> Unit,
    securityManager: SecurityManager
) {
    var title by remember { mutableStateOf("") }
    var price by remember { mutableStateOf("10") }
    var selectedFileUri by remember { mutableStateOf<Uri?>(null) }
    var isUploading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf("") }
    
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val apiService = remember { ApiService() }
    
    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri ->
        selectedFileUri = uri
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Upload Asset") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState())
        ) {
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("Asset Title") },
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(16.dp))

            OutlinedTextField(
                value = price,
                onValueChange = { price = it },
                label = { Text("Price (Coins)") },
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(16.dp))

            Button(
                onClick = { filePickerLauncher.launch("*/*") },
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.AttachFile, "Select File")
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    if (selectedFileUri != null) "File Selected" 
                    else "Select File (Max 10MB)"
                )
            }

            if (selectedFileUri != null) {
                Text(
                    text = "File: ${selectedFileUri.toString().split("/").last()}",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }

            if (errorMessage.isNotEmpty()) {
                Text(
                    text = errorMessage,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }

            Spacer(modifier = Modifier.height(24.dp))

            Button(
                onClick = {
                    if (title.isBlank() || price.isBlank() || selectedFileUri == null) {
                        errorMessage = "Please fill all fields and select a file"
                        return@Button
                    }
                    
                    if (!securityManager.checkSensitiveAction("upload")) {
                        errorMessage = "Security check failed"
                        return@Button
                    }
                    
                    isUploading = true
                    errorMessage = ""
                    
                    scope.launch {
                        try {
                            val inputStream = context.contentResolver.openInputStream(selectedFileUri!!)
                            val file = File(context.cacheDir, "upload_${System.currentTimeMillis()}")
                            file.outputStream().use { output ->
                                inputStream?.copyTo(output)
                            }
                            
                            val fileSizeMB = file.length() / (1024.0 * 1024.0)
                            if (fileSizeMB > 10) {
                                errorMessage = "File too large. Maximum 10MB"
                                file.delete()
                                isUploading = false
                                return@launch
                            }
                            
                            apiService.uploadAsset(
                                token = token,
                                file = file,
                                title = title,
                                priceCoins = price.toIntOrNull() ?: 10
                            ).onSuccess {
                                file.delete()
                                onBack()
                            }.onFailure { error ->
                                file.delete()
                                errorMessage = error.message ?: "Upload failed"
                            }
                        } catch (e: Exception) {
                            errorMessage = e.message ?: "Error processing file"
                        }
                        
                        isUploading = false
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = !isUploading
            ) {
                if (isUploading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                } else {
                    Text("Upload Asset")
                }
            }
        }
    }
}