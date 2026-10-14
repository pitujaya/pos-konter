/* ServisHP Pro — KONFIG SERVER (frontend, mode ALWAYS-ON)
 * ============================================================
 * Agar bisa diakses dari jaringan mana saja MESKI PC Windows mati,
 * backend harus pindah ke server yang hidup 24/7 (VPS Ubuntu).
 * Setelah pindah, frontend disajikan backend yang sama, jadi:
 *
 *   window.SERVISHP_SERVER = "";
 *     -> api.js otomatis pakai origin yang sama (http://IP-VPS/ atau
 *        https://pos.pitujaya.my.id). TIDAK perlu ganti IP tiap pindah jaringan.
 *        Ini mode yang DISARANKAN untuk VPS/Docker/native.
 *
 * Opsi lain (bila perlu kunci manual, sekali saja):
 *   window.SERVISHP_SERVER = "https://pos.pitujaya.my.id";
 *
 * JANGAN isi IP LAN lokal (mis. 192.168.x.x) bila mau diakses dari internet,
 * karena IP LAN tidak bisa dibuka dari luar.
 *
 * User tetap bisa override via Pengaturan > Backend Server
 * (disimpan di localStorage 'servishp_api_base') atau via URL:
 *   https://pos.kamu/?api=https://api.kamu
 *
 * File ini dimuat SEBELUM api.js (lihat index.html).
 */
window.SERVISHP_SERVER = "";
