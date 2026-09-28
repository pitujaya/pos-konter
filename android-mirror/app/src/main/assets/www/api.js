/* ServisHP Pro — API client untuk backend FastAPI.
   Otomatis deteksi base URL:
   - kalau frontend diserve backend (http://localhost:8000/) -> pakai '/api'
   - kalau dibuka via file:// atau Live Server -> pakai http://127.0.0.1:8000/api
   Bisa dioverride: localStorage 'servishp_api_base'
*/
(function () {
  function detectBase() {
    try {
      const saved = localStorage.getItem("servishp_api_base");
      if (saved) return saved.replace(/\/$/, "");
      if (location.origin.startsWith("http") && location.pathname !== undefined) {
        // kalau diserve dari backend yang sama (ada /api/health), pakai origin yang sama
        return location.origin + "/api";
      }
    } catch {}
    return "http://127.0.0.1:8000/api";
  }

  const API = {
    base: detectBase(),
    TOKEN_KEY: "servishp_token_v1",

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

    async req(path, opts = {}) {
      const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
      const tok = this.getToken();
      if (tok) headers["Authorization"] = "Bearer " + tok;
      const res = await fetch(this.base + path, {
        method: opts.method || "GET",
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { detail: text }; }
      if (!res.ok) {
        const msg = (data && (data.detail || data.message)) || ("HTTP " + res.status);
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      return data;
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
