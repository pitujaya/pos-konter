/* ServisHP Pro — KONFIG SERVER UBUNTU (frontend)
 * ============================================================
 * CARA PAKAI (pilih salah satu, urutan prioritas):
 *   1. Isi SERVER_URL di bawah dengan IP/domain Ubuntu, contoh:
 *        window.SERVISHP_SERVER = "http://103.147.9.25:8000";
 *        window.SERVISHP_SERVER = "https://pos.pitujaya.my.id";
 *      Lalu upload file ini ke server. Semua HP/laptop otomatis nyambung.
 *   2. Atau kosongkan ("") -> otomatis pakai origin yang sama (disarankan
 *      bila frontend dibuka dari http://SERVER/ langsung, mis. via Nginx).
 *   3. User tetap bisa override via Pengaturan > Backend Server
 *      (disimpan di localStorage 'servishp_api_base') atau via URL:
 *        https://pos.kamu/?api=https://api.kamu
 *
 * File ini dimuat SEBELUM api.js (lihat index.html).
 */
window.SERVISHP_SERVER = "http://192.168.18.50"; // server Ubuntu native (nginx :80 -> backend :8000)
