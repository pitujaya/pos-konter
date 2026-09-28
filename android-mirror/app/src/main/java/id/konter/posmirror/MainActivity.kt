package id.konter.posmirror

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

/**
 * Mirror native Kotlin — WebView 100% sama persis dengan www/index.html.
 * - Offline: file:///android_asset/www/index.html
 * - Online (emulator): http://10.0.2.2:8000  | HP fisik: http://IP-LAPTOP:8000
 * Ganti USE_BACKEND_URL = true kalau mau mirror live dari backend.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        // true = online (data & fitur sama dengan PC, server harus jalan)
        // kalau server mati, otomatis fallback ke file lokal biar tetap bisa dibuka
        const val USE_BACKEND_URL = true
        // IP laptop (satu WiFi dengan HP). Ganti kalau IP laptop berubah (ipconfig).
        const val BACKEND_URL = "http://192.168.18.8:8000/"
        const val LOCAL_URL = "file:///android_asset/www/index.html"
    }

    private lateinit var web: WebView
    private var fileCb: ValueCallback<Array<Uri>>? = null
    private var pendingPermReq: PermissionRequest? = null

    private val camPerm = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) pendingPermReq?.grant(pendingPermReq?.resources)
        else pendingPermReq?.deny()
        pendingPermReq = null
    }

    private val filePick = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        fileCb?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        fileCb = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            keepScreenOn = true
        }
        setContentView(web)
        hideSystemBars()

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            loadsImagesAutomatically = true
            useWideViewPort = true
            loadWithOverviewMode = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                allowFileAccess = true
            }
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = false

            // Kalau server mati / tidak terjangkau, fallback ke file lokal biar tetap bisa dibuka
            @Suppress("DEPRECATION")
            override fun onReceivedError(
                view: WebView,
                errorCode: Int,
                description: String?,
                failingUrl: String?
            ) {
                if (failingUrl != null && failingUrl.startsWith(BACKEND_URL) && failingUrl != LOCAL_URL) {
                    view.loadUrl(LOCAL_URL)
                } else {
                    super.onReceivedError(view, errorCode, description, failingUrl)
                }
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            // Kamera untuk Scan SKU (getUserMedia / BarcodeDetector)
            override fun onPermissionRequest(request: PermissionRequest) {
                val res = request.resources ?: return super.onPermissionRequest(request)
                val needCam = res.any {
                    it == PermissionRequest.RESOURCE_VIDEO_CAPTURE ||
                        it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
                }
                if (needCam) {
                    if (ContextCompat.checkSelfPermission(
                            this@MainActivity, Manifest.permission.CAMERA
                        ) == PackageManager.PERMISSION_GRANTED
                    ) {
                        request.grant(res)
                    } else {
                        pendingPermReq = request
                        camPerm.launch(Manifest.permission.CAMERA)
                    }
                } else {
                    request.grant(res)
                }
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String, callback: GeolocationPermissions.Callback
            ) = callback.invoke(origin, true, false)

            // Upload gambar slide / restore JSON
            override fun onShowFileChooser(
                view: WebView, cb: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                fileCb?.onReceiveValue(null)
                fileCb = cb
                return try {
                    filePick.launch("*/*")
                    true
                } catch (_: Exception) {
                    fileCb = null
                    false
                }
            }
        }

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl(if (USE_BACKEND_URL) BACKEND_URL else LOCAL_URL)
    }

    override fun onSaveInstanceState(out: Bundle) {
        super.onSaveInstanceState(out)
        if (::web.isInitialized) web.saveState(out)
    }

    @Deprecated("back")
    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack()
        else super.onBackPressed()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
    }
}
