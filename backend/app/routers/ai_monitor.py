"""AI Router + Monitor ala NEXORA — nempel di backend POS.

POST /api/ai/chat/completions = gateway beneran (forward ke provider),
GET  /api/ai/stats|traffic|requests = kartu + grafik,
CRUD /api/ai/providers|clients = kelola.
Tanpa dep tambahan (urllib stdlib).
"""
import json
import secrets
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, require_admin, require_superadmin

router = APIRouter(prefix="/ai", tags=["ai-monitor"])

DEFAULT_PROVIDERS = [
    {"name": "gemini", "kind": "gemini", "base_url": "https://generativelanguage.googleapis.com",
     "model": "gemini-2.0-flash", "price_prompt_per_1k": 0.0001, "price_completion_per_1k": 0.0004, "priority": 1},
    {"name": "gemini-cli", "kind": "openai", "base_url": "https://api.example.com/v1",
     "model": "gemini-cli-default", "price_prompt_per_1k": 0.0, "price_completion_per_1k": 0.0, "priority": 2},
    {"name": "kiro", "kind": "openai", "base_url": "https://api.example.com/v1",
     "model": "kiro-default", "price_prompt_per_1k": 0.0, "price_completion_per_1k": 0.0, "priority": 3},
    {"name": "nvidia", "kind": "openai", "base_url": "https://integrate.api.nvidia.com/v1",
     "model": "meta/llama-3.1-8b-instruct", "price_prompt_per_1k": 0.00006, "price_completion_per_1k": 0.00006, "priority": 4},
    {"name": "ollama", "kind": "ollama", "base_url": "http://127.0.0.1:11434",
     "model": "llama3.1:8b", "price_prompt_per_1k": 0.0, "price_completion_per_1k": 0.0, "priority": 5},
]

DEFAULT_CLIENTS = ["Default Key", "Opencode"]


def _mask(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "***"
    return key[:4] + "***" + key[-3:]


def _est_tokens(text: str) -> int:
    # heuristik ~4 char/token, min 1
    return max(1, len(text or "") // 4)


def _provider_to_out(p: models.AiProvider) -> dict:
    return {
        "id": p.id, "name": p.name, "kind": p.kind or "",
        "base_url": p.base_url or "", "api_key_masked": _mask(p.api_key or ""),
        "model": p.model or "",
        "price_prompt_per_1k": float(p.price_prompt_per_1k or 0),
        "price_completion_per_1k": float(p.price_completion_per_1k or 0),
        "priority": int(p.priority or 1), "is_active": bool(p.is_active),
        "status": p.status or "idle",
        "last_latency_ms": int(p.last_latency_ms or 0),
        "last_error": p.last_error or "",
        "last_check_at": p.last_check_at,
    }


def _ensure_seed(db: Session):
    if db.query(models.AiProvider).count() == 0:
        for d in DEFAULT_PROVIDERS:
            db.add(models.AiProvider(**d))
        db.commit()
    if db.query(models.AiClient).count() == 0:
        for name in DEFAULT_CLIENTS:
            db.add(models.AiClient(name=name, api_key="nxr_" + secrets.token_hex(16)))
        db.commit()


def _http_json(url: str, payload: dict | None = None, headers: dict | None = None, timeout: int = 8, method: str = "GET"):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=dict(headers or {}), method=method)
    if data is not None and "Content-Type" not in req.headers:
        req.add_header("Content-Type", "application/json")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            body = res.read().decode("utf-8", "ignore")
            return time.time() - t0, res.status, body
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", "ignore")
        except Exception:
            body = str(e)
        return time.time() - t0, e.code, body
    except Exception as e:
        return time.time() - t0, 0, str(e)[:500]


def _pick_provider(db: Session, name: str = "", model: str = "") -> models.AiProvider | None:
    _ensure_seed(db)
    q = db.query(models.AiProvider).filter(models.AiProvider.is_active == 1)
    if name:
        p = q.filter(models.AiProvider.name == name).first()
        if p:
            return p
    if model:
        p = q.filter(models.AiProvider.model == model).first()
        if p:
            return p
    rows = q.all()
    rows.sort(key=lambda r: (r.priority or 99, r.id or 0))
    # utamakan yang live, lalu idle, terakhir error/offline
    rank = {"live": 0, "idle": 1, "error": 2, "offline": 3}
    rows.sort(key=lambda r: rank.get((r.status or "idle"), 9))
    return rows[0] if rows else None


def _forward(provider: models.AiProvider, messages: list[dict], model: str, max_tokens: int, temp: float):
    mdl = model or provider.model or ""
    base = (provider.base_url or "").rstrip("/")
    kind = (provider.kind or "openai").lower()
    if kind == "ollama":
        url = base + "/api/chat"
        payload = {"model": mdl, "messages": messages, "stream": False,
                   "options": {"num_predict": max_tokens, "temperature": temp}}
        dt, code, body = _http_json(url, payload, timeout=60, method="POST")
        if code != 200:
            raise RuntimeError(f"ollama {code}: {body[:300]}")
        j = json.loads(body or "{}")
        text = ((j.get("message") or {}).get("content") or "").strip()
        pt = int(j.get("prompt_eval_count") or 0)
        ct = int(j.get("eval_count") or 0)
        if not pt:
            pt = sum(_est_tokens(m.get("content", "")) for m in messages)
        if not ct:
            ct = _est_tokens(text)
        return text, pt, ct
    if kind == "gemini":
        if not provider.api_key:
            raise RuntimeError("gemini butuh api_key (isi di Providers)")
        url = f"{base}/v1/models/{mdl}:generateContent?key={provider.api_key}"
        contents = [{"role": "user" if m.get("role") != "assistant" else "model",
                     "parts": [{"text": m.get("content", "")}]} for m in messages]
        payload = {"contents": contents,
                   "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temp}}
        dt, code, body = _http_json(url, payload, timeout=60, method="POST")
        if code != 200:
            raise RuntimeError(f"gemini {code}: {body[:300]}")
        j = json.loads(body or "{}")
        try:
            text = j["candidates"][0]["content"]["parts"][0]["text"]
        except Exception:
            text = ""
        um = j.get("usageMetadata") or {}
        pt = int(um.get("promptTokenCount") or sum(_est_tokens(m.get("content", "")) for m in messages))
        ct = int(um.get("candidatesTokenCount") or _est_tokens(text))
        return text.strip(), pt, ct
    # default: OpenAI-compatible (nvidia, kiro, gemini-cli, custom)
    url = base + "/chat/completions"
    headers = {"Authorization": f"Bearer {provider.api_key}"} if provider.api_key else {}
    payload = {"model": mdl, "messages": messages, "max_tokens": max_tokens, "temperature": temp}
    dt, code, body = _http_json(url, payload, headers, timeout=60, method="POST")
    if code != 200:
        raise RuntimeError(f"{provider.name} {code}: {body[:300]}")
    j = json.loads(body or "{}")
    try:
        text = j["choices"][0]["message"]["content"] or ""
    except Exception:
        text = ""
    u = j.get("usage") or {}
    pt = int(u.get("prompt_tokens") or sum(_est_tokens(m.get("content", "")) for m in messages))
    ct = int(u.get("completion_tokens") or _est_tokens(text))
    return text.strip(), pt, ct


def _find_client(db: Session, request: Request):
    # 1. X-API-Key header (untuk mesin/Opencode), 2. abaikan (catat sebagai Default Key)
    key = (request.headers.get("x-api-key") or "").strip()
    if key:
        c = db.query(models.AiClient).filter(models.AiClient.api_key == key,
                                             models.AiClient.is_active == 1).first()
        if c:
            return c
        raise HTTPException(401, "X-API-Key tidak valid / nonaktif")
    return None


# ---------- Providers ----------
@router.get("/providers")
def list_providers(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    _ensure_seed(db)
    rows = db.query(models.AiProvider).order_by(models.AiProvider.priority).all()
    return [_provider_to_out(p) for p in rows]


@router.post("/providers", status_code=201)
def upsert_provider(body: schemas.AiProviderIn, db: Session = Depends(get_db),
                    _: models.User = Depends(require_admin)):
    """Kelola provider AI = hak admin.

    Dulu endpoint ini hanya butuh login biasa, jadi kasir biasa bisa menulis
    base_url provider miliknya sendiri -> semua prompt + kunci API milik
    konter bocor ke server dia. Sekarang wajib admin/superadmin.
    """
    _ensure_seed(db)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "name wajib diisi")
    p = db.query(models.AiProvider).filter(models.AiProvider.name == name).first()
    if not p:
        p = models.AiProvider(name=name)
        db.add(p)
    for f in ("kind", "base_url", "api_key", "model"):
        v = getattr(body, f, None)
        if v is not None:
            setattr(p, f, str(v).strip())
    for f in ("price_prompt_per_1k", "price_completion_per_1k"):
        v = getattr(body, f, None)
        if v is not None:
            try:
                setattr(p, f, float(v))
            except Exception:
                pass
    if body.priority is not None:
        try:
            p.priority = int(body.priority)
        except Exception:
            pass
    if body.is_active is not None:
        p.is_active = 1 if body.is_active else 0
    db.commit()
    db.refresh(p)
    return _provider_to_out(p)


@router.post("/providers/{pid}/test")
def test_provider(pid: int, db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    p = db.get(models.AiProvider, pid)
    if not p:
        raise HTTPException(404, "Provider tidak ditemukan")
    base = (p.base_url or "").rstrip("/")
    kind = (p.kind or "openai").lower()
    t0 = time.time()
    try:
        if kind == "ollama":
            _, code, body = _http_json(base + "/api/tags", timeout=6)
            ok = code == 200
            err = "" if ok else body[:200]
        elif kind == "gemini":
            if not p.api_key:
                raise RuntimeError("isi api_key gemini dulu")
            _, code, body = _http_json(f"{base}/v1/models?key={p.api_key}", timeout=8)
            ok = code == 200
            err = "" if ok else body[:200]
        else:
            headers = {"Authorization": f"Bearer {p.api_key}"} if p.api_key else {}
            _, code, body = _http_json(base + "/models", headers, timeout=8)
            # sebagian server tanpa /models tapi chat ok — anggap reachable bila bukan connection error
            ok = code in (200, 401, 403, 404)
            err = "" if code == 200 else (body[:200] if code else "tidak terjangkau")
            if code == 0:
                ok = False
        ms = int((time.time() - t0) * 1000)
        p.last_latency_ms = ms
        p.last_check_at = datetime.utcnow()
        if ok:
            p.status = "live"
            p.last_error = ""
        else:
            p.status = "error"
            p.last_error = err
        db.commit()
        db.refresh(p)
        return _provider_to_out(p)
    except Exception as e:
        p.status = "error"
        p.last_error = str(e)[:200]
        p.last_latency_ms = int((time.time() - t0) * 1000)
        p.last_check_at = datetime.utcnow()
        db.commit()
        db.refresh(p)
        return _provider_to_out(p)


@router.delete("/providers/{pid}")
def del_provider(pid: int, db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    p = db.get(models.AiProvider, pid)
    if not p:
        raise HTTPException(404, "Provider tidak ditemukan")
    db.delete(p)
    db.commit()
    return {"ok": True}


# ---------- Clients ----------
@router.get("/clients")
def list_clients(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """Daftar client TANPA kunci API mentah.

    Dulu endpoint ini mengirim api_key utuh ke semua user yang login. Kunci
    client ini bisa dipakai langsung ke gateway tanpa JWT, jadi hanya
    superadmin yang boleh melihatnya (via /ai/clients/{id}/key).
    """
    _ensure_seed(db)
    rows = db.query(models.AiClient).order_by(models.AiClient.id).all()
    out = []
    for c in rows:
        out.append({"id": c.id, "name": c.name,
                    "api_key_masked": _mask(c.api_key),
                    "rate_limit_per_min": c.rate_limit_per_min, "is_active": bool(c.is_active),
                    "total_requests": c.total_requests or 0, "total_tokens": c.total_tokens or 0,
                    "last_used_at": c.last_used_at})
    return out


@router.get("/clients/{cid}/key")
def reveal_client_key(cid: int, db: Session = Depends(get_db),
                      _: models.User = Depends(require_superadmin)):
    """Tampilkan kunci API client. Hanya superadmin (kunci = akses penuh gateway)."""
    c = db.get(models.AiClient, cid)
    if not c:
        raise HTTPException(404, "Client tidak ditemukan")
    return {"id": c.id, "name": c.name, "api_key": c.api_key,
            "api_key_masked": _mask(c.api_key)}


@router.post("/clients", status_code=201)
def create_client(body: schemas.AiClientIn, db: Session = Depends(get_db),
                  _: models.User = Depends(require_admin)):
    _ensure_seed(db)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "name wajib diisi")
    if db.query(models.AiClient).filter(models.AiClient.name == name).first():
        raise HTTPException(400, "Nama client sudah ada")
    c = models.AiClient(name=name, api_key="nxr_" + secrets.token_hex(16),
                        rate_limit_per_min=int(body.rate_limit_per_min or 60))
    db.add(c)
    db.commit()
    db.refresh(c)
    # Kunci ditampilkan SEKALI saat dibuat (setelah ini hanya tersamar).
    return {"id": c.id, "name": c.name, "api_key": c.api_key,
            "api_key_masked": _mask(c.api_key), "rate_limit_per_min": c.rate_limit_per_min,
            "is_active": True, "total_requests": 0, "total_tokens": 0, "last_used_at": None}


@router.delete("/clients/{cid}")
def del_client(cid: int, db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    c = db.get(models.AiClient, cid)
    if not c:
        raise HTTPException(404, "Client tidak ditemukan")
    db.delete(c)
    db.commit()
    return {"ok": True}


# ---------- Gateway beneran ----------
@router.post("/chat/completions")
def chat_completions(body: schemas.AiChatIn, request: Request, db: Session = Depends(get_db)):
    """Gateway chat.

    Body divalidasi Pydantic (schemas.AiChatIn). Dulu body-nya `dict` mentah,
    jadi payload dengan bentuk salah (mis. messages = "halo") memicu
    AttributeError -> HTTP 500. Sekarang payload salah bentuk -> 422 dengan
    pesan yang jelas.
    """
    _ensure_seed(db)
    # auth: X-API-Key ATAU JWT (dashboard). Tanpa keduanya -> tolak agar tidak disalahgunakan.
    client = None
    try:
        client = _find_client(db, request)
    except HTTPException:
        raise
    user = None
    if client is None:
        auth = request.headers.get("authorization", "")
        if not auth.lower().startswith("bearer "):
            raise HTTPException(401, "Butuh login atau X-API-Key")
        from ..auth import decode_token
        try:
            uid = decode_token(auth.split(None, 1)[1])
        except HTTPException:
            raise
        user = db.get(models.User, uid)
        if not user:
            raise HTTPException(401, "User tidak ditemukan")
        client = db.query(models.AiClient).filter(models.AiClient.name == "Default Key").first()
    msgs = body.messages or []
    if not msgs:
        raise HTTPException(400, "messages wajib diisi")
    # rate limit sederhana per client
    if client is not None:
        since = datetime.utcnow() - timedelta(minutes=1)
        n = db.query(models.AiRequestLog).filter(
            models.AiRequestLog.client_id == client.id,
            models.AiRequestLog.created_at >= since).count()
        if n >= (client.rate_limit_per_min or 60):
            raise HTTPException(429, "Rate limit per menit tercapai")
    provider = _pick_provider(db, body.provider or "", body.model or "")
    if not provider:
        raise HTTPException(503, "Tidak ada provider aktif")
    clean_msgs = [{"role": str(m.role or "user"), "content": str(m.content or "")} for m in msgs]
    t0 = time.time()
    status, err, text, pt, ct = "ok", "", "", 0, 0
    try:
        text, pt, ct = _forward(provider, clean_msgs, body.model or "",
                                int(body.max_tokens or 512), float(body.temperature or 0.7))
    except Exception as e:
        status, err = "error", str(e)[:500]
        provider.status = "error"
        provider.last_error = err[:200]
    ms = int((time.time() - t0) * 1000)
    total = pt + ct
    cost = pt / 1000 * float(provider.price_prompt_per_1k or 0) + ct / 1000 * float(provider.price_completion_per_1k or 0)
    if status == "ok":
        provider.status = "live"
        provider.last_error = ""
    provider.last_latency_ms = ms
    provider.last_check_at = datetime.utcnow()
    log = models.AiRequestLog(
        client_id=client.id if client else None, client_name=(client.name if client else (user.nama if user else "")),
        provider_id=provider.id, provider_name=provider.name, model=body.model or provider.model,
        prompt_tokens=pt, completion_tokens=ct, total_tokens=total, cost_usd=cost,
        latency_ms=ms, status=status, error=err)
    db.add(log)
    if client is not None:
        client.total_requests = (client.total_requests or 0) + 1
        client.total_tokens = (client.total_tokens or 0) + total
        client.last_used_at = datetime.utcnow()
    db.commit()
    if status == "error":
        raise HTTPException(502, f"Provider {provider.name} gagal: {err}")
    return {"provider": provider.name, "model": body.model or provider.model,
            "reply": text, "prompt_tokens": pt, "completion_tokens": ct,
            "total_tokens": total, "cost_usd": round(cost, 6), "latency_ms": ms}


# ---------- Stats / Traffic / Requests (kartu + grafik) ----------
@router.get("/stats")
def stats(minutes: int = Query(60, ge=1, le=1440), db: Session = Depends(get_db),
          _: models.User = Depends(get_current_user)):
    _ensure_seed(db)
    since = datetime.utcnow() - timedelta(minutes=minutes)
    logs = db.query(models.AiRequestLog).filter(models.AiRequestLog.created_at >= since).all()
    ok = [l for l in logs if l.status == "ok"]
    req = len(logs)
    pt = sum(l.prompt_tokens or 0 for l in ok)
    ct = sum(l.completion_tokens or 0 for l in ok)
    cost = sum(l.cost_usd or 0 for l in ok)
    provs = db.query(models.AiProvider).all()
    live = sum(1 for p in provs if (p.status or "") == "live" and p.is_active)
    rate = req / minutes if minutes else 0
    return {"requests": req, "requests_per_min": round(rate, 2),
            "prompt_tokens": pt, "completion_tokens": ct, "total_tokens": pt + ct,
            "cost_usd": round(cost, 4), "providers_live": live, "providers_total": len(provs),
            "clients_total": db.query(models.AiClient).count(),
            "errors": sum(1 for l in logs if l.status == "error")}


@router.get("/traffic")
def traffic(minutes: int = Query(60, ge=5, le=1440), db: Session = Depends(get_db),
            _: models.User = Depends(get_current_user)):
    _ensure_seed(db)
    since = datetime.utcnow() - timedelta(minutes=minutes)
    logs = db.query(models.AiRequestLog).filter(models.AiRequestLog.created_at >= since).all()
    # bucket per ~2 mnt agar pas 30 titik utk 60 mnt
    n = 30
    step = max(1, minutes // n)
    labels, prompt, completion, reqs = [], [], [], []
    now = datetime.utcnow().replace(second=0, microsecond=0)
    for i in range(n, -1, -1):
        end = now - timedelta(minutes=i * step)
        start = end - timedelta(minutes=step)
        b = [l for l in logs if start <= (l.created_at or datetime.min) < end]
        labels.append(end.strftime("%H.%M"))
        prompt.append(sum(l.prompt_tokens or 0 for l in b))
        completion.append(sum(l.completion_tokens or 0 for l in b))
        reqs.append(len(b))
    return {"labels": labels, "prompt": prompt, "completion": completion, "requests": reqs}


@router.get("/requests")
def recent(limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db),
           _: models.User = Depends(get_current_user)):
    rows = db.query(models.AiRequestLog).order_by(models.AiRequestLog.id.desc()).limit(limit).all()
    return [{"id": r.id, "waktu": r.created_at.isoformat() if r.created_at else "",
             "client": r.client_name, "provider": r.provider_name, "model": r.model,
             "prompt": r.prompt_tokens, "completion": r.completion_tokens,
             "tokens": r.total_tokens, "cost": round(r.cost_usd or 0, 6),
             "status": r.status, "error": (r.error or "")[:200], "latency_ms": r.latency_ms}
            for r in rows]
