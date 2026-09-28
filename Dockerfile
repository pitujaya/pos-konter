# ServisHP Pro — image production untuk Ubuntu server
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# User non-root demi keamanan
RUN adduser --disabled-password --gecos "" appuser \
    && mkdir -p /app/frontend /data/uploads \
    && chown -R appuser:appuser /app /data

WORKDIR /app/backend

# Install deps dulu (cache-friendly)
COPY backend/requirements.txt ./requirements.txt
RUN pip install --upgrade pip \
    && pip install -r requirements.txt

# Kode backend
COPY backend/app ./app

# Frontend statis -> /app/frontend (disajikan FastAPI via FRONTEND_DIR)
COPY index.html api.js script.js style.css config.js /app/frontend/
# Aset ikon (opsional, abaikan bila tidak ada -> pakai wildcard aman via shell)
COPY icon.png icon-192.png apple-touch-icon.png /app/frontend/

ENV FRONTEND_DIR=/app/frontend \
    UPLOAD_DIR=/data/uploads \
    DATABASE_URL=sqlite:////data/servishp.db \
    APP_VERSION=1.1.0-ubuntu \
    PORT=8000

RUN chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)" || exit 1

# 2 worker cukup untuk konter/VPS kecil. Naikkan via env UVICORN_WORKERS bila perlu.
CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${UVICORN_WORKERS:-2} --proxy-headers --forwarded-allow-ips '*'"]
