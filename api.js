/* ServisHP Pro — API client untuk backend FastAPI (Ubuntu-ready).
 *
 * Prioritas base URL (dari paling kuat):
 *   1. ?api=https://... di URL (sekali pakai, otomatis disimpan)
 *   2. localStorage 'servishp_api_base' (diatur via Pengaturan > Backend Server)
 *   3. window.SERVISHP_SERVER dari config.js (diisi IP/domain Ubuntu sekali di server)
 *   4. origin yang sama + '/api' (saat frontend dibuka dari http://SERVER/ via nginx/docker)
 *   5. fallback dev lokal http://127.0.0.1:8000/api
 *
 * Fungsi baru:
 *   API.setBase(url)      -> simpan + pakai base baru
 *   API.candidates()      -> daftar kandidat base untuk dicoba
 *   API.autoConnect()     -> ping /health ke tiap kandidat, pakai yg pertama OK
 *   API.req()             -> timeout 12 dtk + pesan error Bahasa Indonesia
 */
(function () {
  var LS_KEY = "servishp_api_base";
  var DEFAULT_LOCAL = "http://127.0.0.1:8000/api";

  function clean(u) {
    if (!u) return "";
    u = String(u).trim().replace(/\/+$/, "");
    if (!u) return "";
    // izinkan input "103.0.0.1:8000" tanpa skema -> tambah http://
    if (!/^https?:\/\//i.test(u) && /^[0-9a-z.\-:]+$/i.test(u)) u = "http://" + u;
    // bila user isi origin tanpa /api, tambahkan
    if (/^https?:\/\/[^/]+$/i.test(u)) u = u + "/api";
    return u;
  }

  function queryApi() {
    try {
      var m = /[?&]api=([^&]+)/.exec(location.search || "");
      if (m && m[1]) return clean(decodeURIComponent(m[1]));
    } catch (e) {}
    return "";
  }

  function savedBase() {
    try {
      var s = localStorage.getItem(LS_KEY);
      if (s) return clean(s);
    } catch (e) {}
    return "";
  }

  function serverBase() {
    try {
      var s = window.SERVISHP_SERVER || "";
      if (s) return clean(s) || clean(s + "/api");
    } catch (e) {}
    return "";
  }

  function sameOriginBase() {
    try {
      if (typeof location !== "undefined" && /^https?:/i.test(location.origin || location.protocol || "")) {
        // file:// punya origin 'null' -> lewati
        if (location.origin && location.origin !== "null" && location.origin.indexOf("http") === 0) {
          return location.origin.replace(/\/+$/, "") + "/api";
        }
      }
    } catch (e) {}
    return "";
  }

  function detectBase() {
    return queryApi() || savedBase() || serverBase() || sameOriginBase() || DEFAULT_LOCAL;
  }

  function candidates() {
    var list = [];
    [queryApi(), savedBase(), serverBase(), sameOriginBase(), DEFAULT_LOCAL].forEach(function (u) {
      if (u && list.indexOf(u) === -1) list.push(u);
    });
    // Varian :8000 langsung (bypass nginx) untuk tiap kandidat http tanpa port explisit.
    // Mis. http://192.168.18.50/api -> tambah http://192.168.18.50:8000/api sebagai cadangan.
    // Berguna bila nginx mati tapi backend masih hidup, atau sebaliknya.
    try {
      list.slice().forEach(function (u) {
        var m = /^(https?:\/\/[^/:]+)(\/api)$/i.exec(u);
        if (m) {
          var alt = clean(m[1] + ":8000/api");
          if (alt && list.indexOf(alt) === -1) list.push(alt);
        }
      });
    } catch (e) {}
    // Bila frontend dibuka dari IP/LAN lain tapi server di :8000 host yg sama,
    // tawarkan juga http://<hostname>:8000/api sebagai kandidat terakhir.
    try {
      if (location.hostname && !/^(localhost|127\.0\.0\.1)$/i.test(location.hostname)) {
        var proto = (location.protocol === "https:") ? "https://" : "http://";
        var alt = clean(proto + location.hostname + ":8000/api");
        if (alt && list.indexOf(alt) === -1) list.push(alt);
      }
    } catch (e) {}
    return list;
  }

  async function ping(base, timeoutMs) {
    var ctl = null, timer = null;
    try {
      if (typeof AbortController !== "undefined") {
        ctl = new AbortController();
        timer = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, timeoutMs || 5000);
      }
      var res = await fetch(base + "/health", {
        signal: ctl ? ctl.signal : undefined,
        headers: { Accept: "application/json" },
      });
      if (timer) clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json().catch(function () { return { ok: true }; });
    } catch (e) {
      if (timer) clearTimeout(timer);
      return null;
    }
  }

  const API = {
    base: detectBase(),
    TOKEN_KEY: "servishp_token_v1",
    TIMEOUT_MS: 12000,

    getToken() {
      try {
        return localStorage.getItem(this.TOKEN_KEY) || sessionStorage.getItem(this.TOKEN_KEY) || null;
      } catch { return null; }
    },
    setToken(token, remember) {
      try {
        if (remember) {
          localStorage.setItem(this.TOKEN_KEY, token);
          sessionStorage.removeItem(this.TOKEN_KEY);
        } else {
          sessionStorage.setItem(this.TOKEN_KEY, token);
          localStorage.removeItem(this.TOKEN_KEY);
        }
      } catch {}
    },
    clearToken() {
      try { localStorage.removeItem(this.TOKEN_KEY); sessionStorage.removeItem(this.TOKEN_KEY); } catch {}
    },

    setBase(url) {
      const c = clean(url);
      if (!c) return this.base;
      this.base = c;
      try { localStorage.setItem(LS_KEY, c); } catch {}
      return this.base;
    },

    candidates: candidates,

    // Coba tiap kandidat, pakai yang pertama yang /health-nya OK.
    // Dipanggil saat aplikasi start agar otomatis nempel ke server Ubuntu.
    async autoConnect(timeoutMs) {
      // ?api= selalu menang & langsung disimpan
      const q = queryApi();
      if (q) this.setBase(q);
      const ordered = [this.base].concat(candidates().filter((x) => x !== this.base));
      for (const base of ordered) {
        const h = await ping(base, timeoutMs || 4000);
        if (h) {
          this.base = base;
          try { localStorage.setItem(LS_KEY, base); } catch {}
          return { base, health: h };
        }
      }
      return null;
    },

    async req(path, opts = {}) {
      const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
      const tok = this.getToken();
      if (tok) headers["Authorization"] = "Bearer " + tok;
      let ctl, timer;
      try {
        if (typeof AbortController !== "undefined") {
          ctl = new AbortController();
          timer = setTimeout(() => { try { ctl.abort(); } catch {} }, opts.timeout || this.TIMEOUT_MS);
        }
        const res = await fetch(this.base + path, {
          method: opts.method || "GET",
          headers,
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: ctl ? ctl.signal : undefined,
        });
        if (timer) clearTimeout(timer);
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = { detail: text }; }
        if (!res.ok) {
          const msg = (data && (data.detail || data.message)) || ("HTTP " + res.status);
          throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
        }
        return data;
      } catch (e) {
        if (timer) clearTimeout(timer);
        if (e && e.name === "AbortError") {
          throw new Error("Server tidak merespon (timeout). Cek IP/domain, firewall, atau service backend.");
        }
        if (e instanceof TypeError) {
          // fetch gagal total (CORS / offline / salah URL)
          throw new Error("Tidak bisa menghubungi " + this.base + ". Cek URL server & jaringan.");
        }
        throw e;
      }
    },

    health() { return this.req("/health"); },
    login(identifier, password, remember = true) {
      return this.req("/auth/login", { method: "POST", body: { identifier, password, remember } });
    },
    register(nama, email, hp, password, role = "kasir") {
      return this.req("/auth/register", { method: "POST", body: { nama, email, hp, password, role } });
    },
    me() { return this.req("/auth/me"); },
    changePassword(new_password) {
      return this.req("/auth/password", { method: "PUT", body: { new_password } });
    },

    listServices(params = {}) {
      const qs = new URLSearchParams({
        q: params.q || "", status: params.status || "Semua",
        sort: params.sort || "baru",
        skip: String(params.skip || 0), limit: String(params.limit || 1000),
      }).toString();
      return this.req("/services?" + qs);
    },
    createService(payload) { return this.req("/services", { method: "POST", body: payload }); },
    updateService(id, payload) { return this.req("/services/" + id, { method: "PUT", body: payload }); },
    setStatus(id, status) { return this.req("/services/" + id + "/status", { method: "PATCH", body: { status } }); },
    deleteService(id) { return this.req("/services/" + id, { method: "DELETE" }); },
    dashboard() { return this.req("/stats/dashboard"); },

    getSettings() { return this.req("/settings"); },
    updateSettings(payload) { return this.req("/settings", { method: "PUT", body: payload }); },
    addTeknisi(nama) { return this.req("/settings/teknisi", { method: "POST", body: { nama } }); },
    delTeknisi(index) { return this.req("/settings/teknisi/" + index, { method: "DELETE" }); },
    addMerk(nama) { return this.req("/settings/merk", { method: "POST", body: { nama } }); },
    delMerk(index) { return this.req("/settings/merk/" + index, { method: "DELETE" }); },

    listUsers() { return this.req("/users"); },
    createUser(payload) { return this.req("/users", { method: "POST", body: payload }); },
    changeRole(id, role) { return this.req("/users/" + id + "/role", { method: "PATCH", body: { role } }); },
    resetUserPw(id, new_password) { return this.req("/users/" + id + "/reset-password", { method: "POST", body: { new_password } }); },
    deleteUser(id) { return this.req("/users/" + id, { method: "DELETE" }); },

    listSlides() { return this.req("/slides"); },
    listAllSlides() { return this.req("/slides/all"); },
    createSlide(payload) { return this.req("/slides", { method: "POST", body: payload }); },
    updateSlide(id, payload) { return this.req("/slides/" + id, { method: "PUT", body: payload }); },
    deleteSlide(id) { return this.req("/slides/" + id, { method: "DELETE" }); },
    listSpareparts(params = {}) {
      const qs = new URLSearchParams({
        q: params.q || "", sort: params.sort || "nama",
        low: params.low ? "true" : "false",
        skip: String(params.skip || 0), limit: String(params.limit || 1000),
      }).toString();
      return this.req("/spareparts?" + qs);
    },
    createSparepart(payload) { return this.req("/spareparts", { method: "POST", body: payload }); },
    updateSparepart(id, payload) { return this.req("/spareparts/" + id, { method: "PUT", body: payload }); },
    adjustStock(id, delta) { return this.req("/spareparts/" + id + "/stock", { method: "PATCH", body: { delta } }); },
    getBySku(sku) { return this.req("/spareparts/sku/" + encodeURIComponent(sku)); },
    deleteSparepart(id) { return this.req("/spareparts/" + id, { method: "DELETE" }); },
    async uploadSlide(file) {
      const tok = this.getToken();
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(this.base + "/slides/upload", {
        method: "POST",
        headers: tok ? { "Authorization": "Bearer " + tok } : {},
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || ("HTTP " + res.status));
      return data;
    },
  };

  window.API = API;
})();
