# POS Konter Mirror — Native Kotlin (ONLINE-ONLY + Produksi)

WebView mirror, bukan rewrite. Tampilan 100% sama dengan `index.html` + `style.css` + `script.js`.

## Cara buka di Android Studio
1. Buka Android Studio > Open > pilih folder `android-mirror`
2. Tunggu Gradle sync
3. Run ke HP / emulator

## Mode ONLINE-ONLY (wajib internet)
- `MainActivity.kt` -> `BACKEND_URL = "https://pos.pitujaya.my.id/"`
- Tanpa internet: tampil layar blokir "Tidak Ada Koneksi Internet", WebView tidak dimuat.
- Internet kembali: otomatis reload via `ConnectivityManager.NetworkCallback`.
- Tidak ada lagi fallback offline ke `file:///android_asset/...`.
- Web (`index.html`) juga ada gate `navigator.onLine` sebagai lapis kedua.

## Biar selalu sama persis
Setiap ubah web, jalankan `sinkron-www.bat` (copy ulang index.html, style.css, script.js, api.js, config.js, icon ke assets).

## Build APK
```
cd android-mirror
./gradlew assembleDebug
```
Hasil: `app/build/outputs/apk/debug/app-debug.apk`
Versi saat ini: `1.5-mobile-scroll (versionCode 6)` — tambah printer Bluetooth thermal via `window.AndroidBT`.

## Printer Bluetooth Thermal (baru)
- Printer 58mm (XPrinter / RPP02 / sejenis), Bluetooth Classic SPP.
- Izin: `BLUETOOTH_CONNECT` + `BLUETOOTH_SCAN` (Android 12+), `BLUETOOTH/ADMIN` (Android ≤30).
- Bridge: `MainActivity.BtBridge` diekspos sebagai `window.AndroidBT`:
  `requestPerms | isAvailable | listPaired | connect(mac) | status | disconnect | printText | printRaw | autoConnect`.
- Web (`script.js`): struk 32 kolom (`buildStrukService/Jual/Test`), UI di Pengaturan › Printer Bluetooth Thermal.
- Alur pakai: Pairing di Settings HP → Pengaturan › Printer → Scan → Sambungkan → Tes Cetak.
  Tombol 🖨 nota otomatis via Bluetooth bila tersambung, fallback `window.print()` bila tidak.

## Link WhatsApp di HP (fix ERR_UNKNOWN_URL_SCHEME)
- Penyebab: `wa.me` redirect ke skema `whatsapp://` yang tidak dimengerti WebView.
- Perbaikan: `shouldOverrideUrlLoading` (dua overload) + `onCreateWindow` (target=_blank)
  membuka semua navigasi non-backend via Intent eksternal (`handleExternalUrl`).
- JS: klik `a.wa-btn` di APK langsung memanggil `AndroidBT.openExternal(href)`.
- Manifest: `<queries>` untuk skema `whatsapp` + `https` (Android 11+).

## Yang sudah di-handle
- JavaScript + LocalStorage + DOM storage ON
- Kamera untuk Scan SKU (permission WebView + runtime CAMERA)
- Upload file (slide / restore JSON) via file chooser
- Tombol Back = WebView back (saat offline: back = keluar)
- Fullscreen immersive + keep screen on
- `ACCESS_NETWORK_STATE` untuk cek internet
- HTTPS produksi (tidak perlu cleartext, tapi tetap diizinkan bila perlu)
