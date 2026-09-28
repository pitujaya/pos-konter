# POS Konter Mirror — Native Kotlin (sama persis)

WebView mirror, bukan rewrite. Tampilan 100% sama dengan `index.html` + `style.css` + `script.js`.

## Cara buka di Android Studio
1. Buka Android Studio > Open > pilih folder `android-mirror`
2. Tunggu Gradle sync
3. Run ke HP / emulator

## Mode mirror
- Default offline: `file:///android_asset/www/index.html`
- Mau live dari backend: di `MainActivity.kt` set `USE_BACKEND_URL = true`
  - Emulator: `http://10.0.2.2:8000/`
  - HP fisik: ganti `BACKEND_URL` ke IP laptop, mis. `http://192.168.1.5:8000/`

## Biar selalu sama persis
Setiap ubah web, jalankan `sinkron-www.bat` (copy ulang 4 file ke assets).

## Build APK
```
cd android-mirror
./gradlew assembleDebug
```
Hasil: `app/build/outputs/apk/debug/app-debug.apk`

## Yang sudah di-handle
- JavaScript + LocalStorage + DOM storage ON
- Kamera untuk Scan SKU (permission WebView + runtime CAMERA)
- Upload file (slide / restore JSON) via file chooser
- Tombol Back = WebView back
- Fullscreen immersive + keep screen on
- Cleartext HTTP diizinkan (IP lokal)
