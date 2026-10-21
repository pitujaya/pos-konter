package id.konter.posmirror

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.Charset
import java.util.UUID
import java.util.concurrent.Executors

/**
 * POS Konter Mirror — MODE ONLINE-ONLY + PRINTER BLUETOOTH THERMAL.
 * - WebView memuat BACKEND_URL, JS memanggil window.AndroidBT untuk cetak struk.
 * - Printer = Bluetooth Classic SPP (XPrinter / RPP02 / sejenis).
 *   Pairing lebih dulu via Settings Android, lalu pilih di Pengaturan > Printer.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        // Produksi (Cloudflare Tunnel -> VPS): frontend + API satu pintu.
        // api.js otomatis pakai https://pos.pitujaya.my.id/api via same-origin.
        const val BACKEND_URL = "https://pos.pitujaya.my.id/"
        const val API_BASE = "https://pos.pitujaya.my.id/api"
        const val TOKEN_KEY = "servishp_token_v1"
        const val PREFS_AUTH = "pos_auth"
        // UUID SPP standar printer thermal bluetooth
        val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }

    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private lateinit var offlineView: LinearLayout
    private lateinit var loadingView: LinearLayout
    private var fileCb: ValueCallback<Array<Uri>>? = null
    private var pendingPermReq: PermissionRequest? = null
    private var connMgr: ConnectivityManager? = null
    private var netCallback: ConnectivityManager.NetworkCallback? = null
    private var isOfflineShown = false
    private var firstScreenResolved = false
    private var autoLoginChecked = false
    private var autoLoginInFlight = false

    private val bg = Executors.newSingleThreadExecutor()

    // ================= AUTO LOGIN (native, sebelum WebView pakai token) =================

    private fun autoLoginPrefs() = getSharedPreferences(PREFS_AUTH, MODE_PRIVATE)

    private fun autoLoginEnabled(): Boolean =
        BuildConfig.AUTO_LOGIN &&
            BuildConfig.AUTO_LOGIN_ID.isNotBlank() &&
            BuildConfig.AUTO_LOGIN_PW.isNotBlank()

    private fun postToApi(path: String, json: JSONObject?): Pair<Int, String> {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(API_BASE + path).openConnection() as HttpURLConnection).apply {
                requestMethod = if (json == null) "GET" else "POST"
                connectTimeout = 12000
                readTimeout = 12000
                setRequestProperty("Accept", "application/json")
                if (json != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }
            }
            if (json != null) conn.outputStream.use { it.write(json.toString().toByteArray(Charset.forName("UTF-8"))) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
            code to body
        } catch (e: Exception) {
            -1 to (e.message ?: "error")
        } finally {
            try { conn?.disconnect() } catch (_: Exception) {}
        }
    }

    /** Dipanggil sekali setelah halaman backend selesai load. */
    private fun tryAutoLogin() {
        if (firstScreenResolved) return
        if (autoLoginChecked || autoLoginInFlight) {
            // Sudah dicoba (mis. setelah reload) -> vaginalkan overlay.
            if (autoLoginChecked && !autoLoginInFlight) resolveFirstScreen()
            return
        }
        autoLoginChecked = true
        if (!autoLoginEnabled() || !isOnline()) {
            resolveFirstScreen()
            return
        }

        val prefs = autoLoginPrefs()
        if (prefs.getBoolean("auto_login_off", false)) {
            resolveFirstScreen()
            return
        }

        val cached = prefs.getString("token", null)
        autoLoginInFlight = true
        bg.execute {
            var token: String? = null
            if (!cached.isNullOrBlank()) {
                // Validasi token lama; masih hidup -> pakai lagi (tanpa request login baru).
                var ok = false
                try {
                    var conn: HttpURLConnection? = null
                    conn = (URL(API_BASE + "/auth/me").openConnection() as HttpURLConnection).apply {
                        requestMethod = "GET"
                        connectTimeout = 10000
                        readTimeout = 10000
                        setRequestProperty("Authorization", "Bearer $cached")
                    }
                    ok = conn.responseCode in 200..299
                    conn.disconnect()
                } catch (_: Exception) {}
                if (ok) token = cached
            }
            if (token == null) {
                val body = JSONObject()
                    .put("identifier", BuildConfig.AUTO_LOGIN_ID.trim())
                    .put("password", BuildConfig.AUTO_LOGIN_PW)
                    .put("remember", true)
                val (code, resp) = postToApi("/auth/login", body)
                if (code in 200..299) {
                    try {
                        token = JSONObject(resp).optString("access_token").takeIf { it.isNotBlank() }
                    } catch (_: Exception) { token = null }
                }
            }
            val finalToken = token
            runOnUiThread {
                autoLoginInFlight = false
                if (finalToken.isNullOrBlank()) {
                    resolveFirstScreen()
                    return@runOnUiThread
                }
                prefs.edit()
                    .putString("token", finalToken)
                    .putString("id", BuildConfig.AUTO_LOGIN_ID.trim())
                    .putLong("at", System.currentTimeMillis())
                    .apply()
                // Inject token ke localStorage, lalu reload agar script.js init() memakainya.
                web.evaluateJavascript(
                    "(function(){try{localStorage.setItem('${TOKEN_KEY}'," +
                        JSONObject.quote(finalToken) +
                        ");return 1;}catch(e){return 0;}})()"
                ) {
                    web.reload()
                }
            }
        }
    }

    /** Bridge auth: dipanggil JS saat user logout manual. */
    inner class AuthBridge {
        @JavascriptInterface
        fun onLogout() {
            runOnUiThread {
                autoLoginPrefs().edit().remove("token").putBoolean("auto_login_off", true).apply()
            }
        }
        @JavascriptInterface
        fun isAutoLogin(): Boolean = autoLoginEnabled()
    }

    private fun buildLoadingView(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(Color.parseColor("#0f172a"))
        isClickable = true
        val icon = TextView(this@MainActivity).apply {
            text = "\uD83D\uDD11"
            textSize = 48f
            gravity = Gravity.CENTER
        }
        val txt = TextView(this@MainActivity).apply {
            text = "Sedang masuk…"
            textSize = 16f
            setTextColor(Color.parseColor("#cbd5e1"))
            gravity = Gravity.CENTER
        }
        addView(icon)
        addView(txt)
    }

    // ---------- Bluetooth printer state ----------
    @Volatile private var btSocket: BluetoothSocket? = null
    @Volatile private var btName: String = ""
    @Volatile private var btMac: String = ""

    private val camPerm = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) pendingPermReq?.grant(pendingPermReq?.resources)
        else pendingPermReq?.deny()
        pendingPermReq = null
    }

    private val btPerms = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* hasil dibaca ulang saat method dipanggil; tidak perlu aksi khusus */ }

    private val btEnable = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { /* user menyalakan/membatalkan; status dibaca saat method dipanggil */ }

    private val filePick = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        fileCb?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        fileCb = null
    }

    // ================= BRIDGE UNTUK JAVASCRIPT =================
    inner class BtBridge {

        private fun hasBtConnect(): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
            return ContextCompat.checkSelfPermission(
                this@MainActivity, Manifest.permission.BLUETOOTH_CONNECT
            ) == PackageManager.PERMISSION_GRANTED
        }

        private fun adapter(): BluetoothAdapter? {
            return try {
                val mgr = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
                mgr?.adapter ?: @Suppress("DEPRECATION") BluetoothAdapter.getDefaultAdapter()
            } catch (_: Exception) { null }
        }

        fun ensurePerms() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val need = mutableListOf<String>()
                    if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED)
                        need.add(Manifest.permission.BLUETOOTH_CONNECT)
                    if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED)
                        need.add(Manifest.permission.BLUETOOTH_SCAN)
                    if (need.isNotEmpty()) btPerms.launch(need.toTypedArray())
                }
            } catch (_: Exception) {}
        }

        /** Dipanggil JS untuk minta izin + nyalakan bluetooth bila mati. */
        @JavascriptInterface
        fun requestPerms(): String {
            ensurePerms()
            return try {
                val a = adapter()
                if (a == null) ok(false, "HP tidak punya bluetooth")
                else if (!a.isEnabled) {
                    try {
                        if (hasBtConnect()) {
                            btEnable.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
                            ok(true, "Menunggu bluetooth dinyalakan…")
                        } else ok(false, "Izin bluetooth belum diberikan")
                    } catch (e: Exception) { ok(false, e.message ?: "gagal") }
                } else ok(true, "ok")
            } catch (e: Exception) { ok(false, e.message ?: "gagal") }
        }

        @JavascriptInterface
        fun isAvailable(): String {
            val a = adapter()
            val en = try { a?.isEnabled == true } catch (_: Exception) { false }
            return JSONObject()
                .put("ok", a != null)
                .put("enabled", en)
                .put("connected", isConnected())
                .put("name", btName)
                .put("mac", btMac).toString()
        }

        /** Daftar perangkat yang SUDAH di-pairing (tanpa scan, tanpa lokasi). */
        @JavascriptInterface
        fun listPaired(): String {
            ensurePerms()
            return try {
                if (!hasBtConnect()) return err("Izin BLUETOOTH_CONNECT belum diberikan. Klik Minta Izin dulu.")
                val a = adapter() ?: return err("HP tidak punya bluetooth")
                if (!a.isEnabled) return err("Bluetooth mati. Nyalakan dulu di Settings / klik Minta Izin.")
                val arr = JSONArray()
                a.bondedDevices?.forEach { d ->
                    try {
                        arr.put(JSONObject().put("name", d.name ?: "Tanpa nama").put("mac", d.address))
                    } catch (_: Exception) {}
                }
                JSONObject().put("ok", true).put("devices", arr).toString()
            } catch (e: SecurityException) {
                err("Izin bluetooth ditolak: " + e.message)
            } catch (e: Exception) {
                err(e.message ?: "gagal membaca paired devices")
            }
        }

        /** Sambung ke printer via MAC. Blocking ±8 dtk (dijalankan di thread JS bridge). */
        @JavascriptInterface
        fun connect(mac: String): String {
            ensurePerms()
            return try {
                if (!hasBtConnect()) return err("Izin BLUETOOTH_CONNECT belum diberikan.")
                val a = adapter() ?: return err("HP tidak punya bluetooth")
                if (!a.isEnabled) return err("Bluetooth mati.")
                val clean = mac.trim().uppercase()
                if (!Regex("^([0-9A-F]{2}:){5}[0-9A-F]{2}$").matches(clean))
                    return err("MAC tidak valid: $mac")
                disconnectInternal()
                val dev = a.getRemoteDevice(clean)
                val sock = dev.createRfcommSocketToServiceRecord(SPP_UUID)
                try { a.cancelDiscovery() } catch (_: Exception) {}
                sock.connect() // blocking
                btSocket = sock
                btName = try { dev.name ?: "" } catch (_: Exception) { "" }
                btMac = clean
                try {
                    getSharedPreferences("pos_bt", MODE_PRIVATE).edit()
                        .putString("mac", clean).putString("name", btName).apply()
                } catch (_: Exception) {}
                JSONObject().put("ok", true).put("name", btName).put("mac", btMac).toString()
            } catch (e: SecurityException) {
                err("Izin ditolak / pairing belum: " + e.message)
            } catch (e: IOException) {
                disconnectInternal()
                err("Gagal konek (pastikan printer ON, belum dipakai HP lain, & sudah Pairing): " + e.message)
            } catch (e: Exception) {
                disconnectInternal()
                err(e.message ?: "gagal konek")
            }
        }

        @JavascriptInterface
        fun status(): String {
            return JSONObject()
                .put("ok", true)
                .put("connected", isConnected())
                .put("name", btName)
                .put("mac", btMac).toString()
        }

        @JavascriptInterface
        fun disconnect(): String {
            disconnectInternal()
            return ok(true, "diputus")
        }

        /** Cetak teks struk (plain text 32 kolom). Otomatis ESC @ + feed + cut. */
        @JavascriptInterface
        fun printText(text: String): String {
            return try {
                val s = btSocket
                if (!isConnected() || s == null) return err("Printer belum tersambung. Sambungkan dulu.")
                val out = s.outputStream
                val clean = asciiForPrinter(text ?: "")
                val bytes = clean.toByteArray(Charsets.ISO_8859_1)
                if (bytes.isEmpty()) return err("Isi cetak kosong.")
                // Beri jeda: printer sering butuh waktu bangun setelah connect
                Thread.sleep(300)
                // ESC @ = reset printer
                out.write(byteArrayOf(0x1B, 0x40))
                // ESC t 0 = pilih codepage PC437, ESC a 0 = rata kiri, ESC 2 = spasi baris default
                out.write(byteArrayOf(0x1B, 0x74, 0x00))
                out.write(byteArrayOf(0x1B, 0x61, 0x00))
                out.write(byteArrayOf(0x1B, 0x32))
                out.flush()
                Thread.sleep(150)
                // Kirim per potongan + jeda: printer murah dropping data kalau dikirim dadakan
                writeSlow(out, bytes)
                // ESC d 4 = feed 4 baris
                out.write(byteArrayOf(0x1B, 0x64, 0x04))
                out.flush()
                Thread.sleep(250)
                // GS V 0 = partial cut
                out.write(byteArrayOf(0x1D, 0x56, 0x00))
                out.flush()
                ok(true, "tercetak (" + bytes.size + " byte)")
            } catch (e: IOException) {
                disconnectInternal()
                err("Gagal cetak / koneksi putus: " + e.message)
            } catch (e: Exception) {
                err(e.message ?: "gagal cetak")
            }
        }

        /** Cetak sample langsung dari native (untuk cek printer tanpa lewat teks JS). */
        @JavascriptInterface
        fun testPrint(): String {
            val sample = buildString {
                append("POS KONTER - TES PRINTER\n")
                append("--------------------------------\n")
                append("12345678901234567890123456789012\n")
                append("Kiri              |   Kanan\n")
                append("--------------------------------\n")
                append("OK - printer siap dipakai\n")
            }
            return printText(sample)
        }

        /** Teks -> ASCII aman printer thermal (emoji/huruf non-ASCII dibuang). */
        private fun asciiForPrinter(text: String): String {
            val sb = StringBuilder(text.length)
            for (ch in text) {
                when {
                    ch == '\n' -> sb.append("\r\n")
                    ch == '\r' -> Unit
                    ch == '\t' -> sb.append("  ")
                    ch.code in 32..126 -> sb.append(ch)
                    ch == '—' || ch == '–' -> sb.append('-')
                    ch == '‘' || ch == '’' -> sb.append('\'')
                    ch == '“' || ch == '”' -> sb.append('"')
                    ch == '•' -> sb.append('-')
                    ch == '…' -> sb.append("...")
                    ch.code < 32 -> Unit
                    else -> sb.append('?')
                }
            }
            return sb.toString()
        }

        /** Tulis bytes per potongan dengan jeda kecil (anti data hilang di printer murah). */
        private fun writeSlow(out: java.io.OutputStream, bytes: ByteArray, chunk: Int = 80, delayMs: Long = 25) {
            var i = 0
            while (i < bytes.size) {
                val n = minOf(chunk, bytes.size - i)
                out.write(bytes, i, n)
                out.flush()
                i += n
                if (i < bytes.size) Thread.sleep(delayMs)
            }
        }

        /** Cetak bytes ESC/POS mentah dalam Base64 (untuk logo/QR di masa depan). */
        @JavascriptInterface
        fun printRaw(base64: String): String {
            return try {
                val s = btSocket
                if (!isConnected() || s == null) return err("Printer belum tersambung.")
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                val out = s.outputStream
                out.write(bytes)
                out.flush()
                ok(true, "tercetak")
            } catch (e: Exception) {
                err(e.message ?: "gagal cetak raw")
            }
        }

        /** Coba sambung otomatis ke MAC terakhir tersimpan. */
        @JavascriptInterface
        fun autoConnect(): String {
            return try {
                if (isConnected()) return status()
                val sp = getSharedPreferences("pos_bt", MODE_PRIVATE)
                val mac = sp.getString("mac", "") ?: ""
                if (mac.isEmpty()) return err("Belum ada printer tersimpan.")
                connect(mac)
            } catch (e: Exception) { err(e.message ?: "gagal") }
        }

        /** Buka URL eksternal (WA / tel: / browser) via Intent Android. Dipakai tombol 💬 WA. */
        @JavascriptInterface
        fun openExternal(url: String): String {
            return try {
                val u = url.trim()
                if (u.isEmpty()) return err("URL kosong")
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(u))
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                // Plakban: whatsapp:// tanpa WA terinstal -> fallback ke wa.me https
                try {
                    startActivity(intent)
                    ok(true, "dibuka")
                } catch (_: Exception) {
                    if (u.startsWith("whatsapp://", ignoreCase = true)) {
                        val m = Regex("[?&]phone=([0-9]+)").find(u)
                        val ph = m?.groupValues?.getOrNull(1) ?: ""
                        val fallback = if (ph.isNotEmpty()) "https://wa.me/$ph" else "https://wa.me/"
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(fallback)).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        })
                        ok(true, "dibuka via browser")
                    } else throw IllegalStateException("Tidak ada aplikasi untuk membuka: $u")
                }
            } catch (e: Exception) { err(e.message ?: "gagal buka link") }
        }

        private fun isConnected(): Boolean {
            return try { btSocket?.isConnected == true } catch (_: Exception) { false }
        }

        private fun disconnectInternal() {
            try { btSocket?.close() } catch (_: Exception) {}
            btSocket = null
            // nama/mac tetap disimpan untuk tampilan; status connected=false
        }

        private fun ok(v: Boolean, msg: String): String =
            JSONObject().put("ok", v).put("message", msg).toString()

        private fun err(msg: String): String =
            JSONObject().put("ok", false).put("message", msg).toString()
    }

    // ---------- Cek internet ----------
    private fun isOnline(): Boolean {
        val cm = connMgr ?: return false
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val net = cm.activeNetwork ?: return false
                val caps = cm.getNetworkCapabilities(net) ?: return false
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                    caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) &&
                    (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ||
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN))
            } else {
                @Suppress("DEPRECATION")
                val info = cm.activeNetworkInfo
                @Suppress("DEPRECATION")
                info != null && info.isConnected
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun showOffline() {
        runOnUiThread {
            isOfflineShown = true
            offlineView.visibility = View.VISIBLE
            loadingView.visibility = View.GONE
            web.visibility = View.GONE
        }
    }

    private fun showOnline() {
        runOnUiThread {
            isOfflineShown = false
            offlineView.visibility = View.GONE
            web.visibility = View.VISIBLE
            if (firstScreenResolved) loadingView.visibility = View.GONE
        }
    }

    /** Gate utama: hanya load WebView kalau online, kalau tidak tampilkan blokir. */
    private fun loadOrBlock() {
        if (isOnline()) {
            val wasOffline = isOfflineShown
            showOnline()
            // Saat pertama kali buka: tampilkan overlay "Sedang masuk…"
            // sampai auto login selesai (atau gagal) lalu WebView ditampilkan.
            if (!firstScreenResolved) loadingView.visibility = View.VISIBLE
            // Jangan reload berulang saat onResume — hanya load kalau belum ada URL,
            // atau reload kalau sebelumnya sedang offline / URL bukan backend.
            val cur = try { web.url ?: "" } catch (_: Exception) { "" }
            if (cur.isEmpty() || !cur.startsWith(BACKEND_URL)) {
                web.loadUrl(BACKEND_URL)
            } else if (wasOffline) {
                web.reload()
            }
        } else {
            try { web.stopLoading() } catch (_: Exception) {}
            showOffline()
        }
    }

    private fun resolveFirstScreen() {
        if (firstScreenResolved) return
        firstScreenResolved = true
        runOnUiThread {
            loadingView.visibility = View.GONE
            if (!isOfflineShown) web.visibility = View.VISIBLE
        }
    }

    private fun registerNetworkCallback() {
        val cm = connMgr ?: return
        // Hindari double-register saat retry
        try { netCallback?.let { cm.unregisterNetworkCallback(it) } } catch (_: Exception) {}
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                runOnUiThread {
                    // Internet kembali -> otomatis masuk ke server
                    if (isOfflineShown) loadOrBlock()
                }
            }
            override fun onLost(network: Network) {
                runOnUiThread {
                    if (!isOnline()) {
                        try { web.stopLoading() } catch (_: Exception) {}
                        showOffline()
                    }
                }
            }
            override fun onUnavailable() {
                runOnUiThread { showOffline() }
            }
        }
        netCallback = cb
        try {
            val req = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            cm.registerNetworkCallback(req, cb)
        } catch (_: Exception) {}
    }

    /**
     * true = URL sudah dibuka via Intent eksternal (WebView jangan load).
     * - Skema khusus (whatsapp://, tel:, mailto:, sms:, intent://) selalu eksternal.
     * - Host WA (wa.me, whatsapp.com) selalu eksternal (biar dibuka aplikasi WA / browser).
     * - Navigasi http(s) BUKAN backend juga eksternal (mencegah WebView nyangkut di situs luar).
     * - URL backend (BACKEND_URL) selalu internal (return false).
     */
    private fun handleExternalUrl(url: String?): Boolean {
        if (url.isNullOrEmpty()) return false
        return try {
            val low = url.lowercase()
            if (url.startsWith(BACKEND_URL)) return false
            val special = low.startsWith("whatsapp://") || low.startsWith("tel:") ||
                low.startsWith("mailto:") || low.startsWith("sms:") ||
                low.startsWith("intent://") || low.startsWith("intent:")
            val isHttp = low.startsWith("http://") || low.startsWith("https://")
            // Satu-satunya situs internal = backend. Navigasi http(s) lain (wa.me, dsb.) -> eksternal.
            // (Resource seperti fonts difilter via isForMainFrame pada overload modern.)
            if (special || (isHttp && !url.startsWith(BACKEND_URL))) {
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(intent)
                } catch (_: Exception) {
                    // Fallback: whatsapp:// tanpa aplikasi -> buka wa.me di browser
                    try {
                        if (low.startsWith("whatsapp://")) {
                            val m = Regex("[?&]phone=([0-9]+)").find(url)
                            val ph = m?.groupValues?.getOrNull(1) ?: ""
                            val fb = if (ph.isNotEmpty()) "https://wa.me/$ph" else "https://wa.me/"
                            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(fb)).apply {
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            })
                        } else {
                            Toast.makeText(this, "Tidak ada aplikasi untuk membuka link", Toast.LENGTH_SHORT).show()
                        }
                    } catch (_: Exception) {}
                }
                true
            } else false
        } catch (_: Exception) { false }
    }

    private fun buildOfflineView(): LinearLayout {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#0f172a"))
            setPadding(64, 64, 64, 64)
            visibility = View.GONE
        }
        val icon = TextView(this).apply {
            text = "\uD83D\uDCF6"
            textSize = 64f
            gravity = Gravity.CENTER
        }
        val title = TextView(this).apply {
            text = "Tidak Ada Koneksi Internet"
            textSize = 22f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        val desc = TextView(this).apply {
            text = "APK POS Konter ini hanya bisa dijalankan saat online.\nAktifkan WiFi / Data seluler, lalu coba lagi."
            textSize = 15f
            setTextColor(Color.parseColor("#cbd5e1"))
            gravity = Gravity.CENTER
        }
        val retry = Button(this).apply {
            text = "🔄 Coba Lagi"
            setOnClickListener { loadOrBlock() }
        }
        val exit = Button(this).apply {
            text = "Keluar"
            setOnClickListener { finish() }
        }
        layout.addView(icon)
        layout.addView(title)
        layout.addView(desc)
        layout.addView(retry)
        layout.addView(exit)
        return layout
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        connMgr = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

        root = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        web = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            keepScreenOn = true
        }
        root.addView(web)

        offlineView = buildOfflineView()
        root.addView(
            offlineView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        loadingView = buildLoadingView()
        root.addView(
            loadingView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        setContentView(root)
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
            // Tombol WA pakai target="_blank" -> wajib dukung multi-window agar bisa di-intercept
            setSupportMultipleWindows(true)
            @Suppress("DEPRECATION")
            setJavaScriptCanOpenWindowsAutomatically(true)
        }

        // Bridge printer bluetooth + openExternal -> dipanggil JS via window.AndroidBT
        try { web.addJavascriptInterface(BtBridge(), "AndroidBT") } catch (_: Exception) {
            Toast.makeText(this, "Gagal pasang bridge printer", Toast.LENGTH_SHORT).show()
        }
        // Bridge auth: window.AndroidAuth.onLogout() saat user logout manual
        try { web.addJavascriptInterface(AuthBridge(), "AndroidAuth") } catch (_: Exception) {}

        web.webViewClient = object : WebViewClient() {
            // Link eksternal (WA / tel: / whatsapp:// / browser luar) -> buka via Intent, JANGAN di WebView.
            // Ini perbaikan bug ERR_UNKNOWN_URL_SCHEME saat klik tombol 💬 WA (wa.me redirect ke whatsapp://).
            @Suppress("DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                handleExternalUrl(url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return try {
                    // Hanya intercept navigasi utama; resource (gambar/font) tetap dimuat WebView
                    if (!request.isForMainFrame) return false
                    handleExternalUrl(request.url.toString())
                } catch (_: Exception) { false }
            }

            // ONLINE-ONLY: server tidak terjangkau -> tampilkan layar blokir,
            // JANGAN fallback ke file lokal.
            @Suppress("DEPRECATION")
            override fun onReceivedError(
                view: WebView,
                errorCode: Int,
                description: String?,
                failingUrl: String?
            ) {
                if (failingUrl != null && failingUrl.startsWith(BACKEND_URL)) {
                    showOffline()
                } else {
                    super.onReceivedError(view, errorCode, description, failingUrl)
                }
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (request.url.toString().startsWith(BACKEND_URL)) {
                    showOffline()
                } else {
                    super.onReceivedError(view, request, error)
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                // Kalau halaman backend berhasil dibuka & masih online, sembunyikan blokir
                if (url.startsWith(BACKEND_URL) && isOnline()) {
                    showOnline()
                    // Auto login: coba inject token sebelum script.js init() membaca localStorage.
                    if (!firstScreenResolved) tryAutoLogin() else resolveFirstScreen()
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

            // Link target="_blank" (tombol 💬 WA) -> arahkan lewat handleExternalUrl juga.
            // Tanpa ini, klik WA di WebView tidak memicu shouldOverrideUrlLoading.
            override fun onCreateWindow(
                view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message
            ): Boolean {
                return try {
                    val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
                    val tmp = WebView(view.context)
                    tmp.webViewClient = object : WebViewClient() {
                        @Suppress("DEPRECATION")
                        override fun shouldOverrideUrlLoading(v: WebView, url: String): Boolean =
                            handleExternalUrl(url)
                        override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean =
                            handleExternalUrl(request.url.toString())
                    }
                    transport.webView = tmp
                    resultMsg.sendToTarget()
                    true
                } catch (_: Exception) { false }
            }

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

        registerNetworkCallback()

        if (savedInstanceState != null) {
            // Restore hanya kalau masih online, kalau offline tetap blokir
            if (isOnline()) {
                web.restoreState(savedInstanceState)
                showOnline()
            } else {
                showOffline()
            }
        } else {
            loadOrBlock()
        }
    }

    override fun onResume() {
        super.onResume()
        // Cek ulang tiap kembali ke aplikasi (mis. user baru nyalakan data)
        loadOrBlock()
    }

    override fun onSaveInstanceState(out: Bundle) {
        super.onSaveInstanceState(out)
        if (::web.isInitialized) web.saveState(out)
    }

    override fun onDestroy() {
        try {
            netCallback?.let { connMgr?.unregisterNetworkCallback(it) }
        } catch (_: Exception) {}
        try { btSocket?.close() } catch (_: Exception) {}
        try { bg.shutdownNow() } catch (_: Exception) {}
        super.onDestroy()
    }

    @Deprecated("back")
    override fun onBackPressed() {
        // Saat layar offline tampil, tombol back = keluar (jangan masuk WebView kosong)
        if (isOfflineShown) {
            super.onBackPressed()
            return
        }
        if (!::web.isInitialized) {
            super.onBackPressed()
            return
        }
        // UX baru: TIDAK ada bottom-nav, semua menu di sidebar.
        // Back ke-1: tutup modal bila ada, kalau tidak -> BUKA sidebar untuk pilih menu.
        // Back ke-2 (sidebar sudah terbuka): keluar aplikasi.
        try {
            web.evaluateJavascript(
                "(function(){try{var s=document.getElementById('sidebar');var o=(s&&s.classList.contains('open'))?1:0;var m=document.querySelector('.modal-bg:not(.hidden)')?1:0;return o+'|'+m;}catch(e){return '0|0';}})()"
            ) { raw ->
                try {
                    var r = (raw ?: "").trim()
                    if (r.length >= 2 && r.startsWith("\"") && r.endsWith("\"")) {
                        r = r.substring(1, r.length - 1).replace("\\n", "").replace("\\\"", "\"")
                    }
                    val parts = r.split("|")
                    val sidebarOpen = parts.getOrNull(0)?.trim() == "1"
                    val modalOpen = parts.getOrNull(1)?.trim() == "1"
                    if (modalOpen) {
                        try {
                            web.evaluateJavascript(
                                "(function(){try{if(typeof closeAllModals==='function'){closeAllModals();}else{document.querySelectorAll('.modal-bg').forEach(function(x){x.classList.add('hidden')});}if(typeof closeScan==='function'){try{closeScan();}catch(_){}}}catch(e){} return 1;})()",
                                null
                            )
                        } catch (_: Exception) {}
                        return@evaluateJavascript
                    }
                    if (!sidebarOpen) {
                        try {
                            web.evaluateJavascript(
                                "(function(){try{if(typeof openSidebar==='function'){openSidebar();}else{var s=document.getElementById('sidebar');if(s)s.classList.add('open');var o=document.getElementById('sidebarOverlay');if(o)o.classList.add('show');}return 1;}catch(e){return 0;}})()",
                                null
                            )
                        } catch (_: Exception) {}
                        // konsumsi back, jangan keluar / jangan web.goBack
                        return@evaluateJavascript
                    }
                    // Sidebar sudah terbuka -> tekan back lagi = keluar
                    try {
                        super.onBackPressed()
                    } catch (_: Exception) {}
                } catch (_: Exception) {
                    // fallback aman: coba buka sidebar, jangan keluar
                    try {
                        web.evaluateJavascript(
                            "(function(){try{if(typeof openSidebar==='function'){openSidebar();return 1;}var s=document.getElementById('sidebar');if(s)s.classList.add('open');return 1;}catch(e){return 0;}})()",
                            null
                        )
                    } catch (_: Exception) {}
                }
            }
        } catch (_: Exception) {
            try {
                super.onBackPressed()
            } catch (_: Exception) {}
        }
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
