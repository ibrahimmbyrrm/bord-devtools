"""Optional local DEV workbench mounted by anvex-webapp at /dev."""
from __future__ import annotations

import json

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse

from . import runtime
from .server import check_payload, page

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def local_only(request: Request, call_next):
    host = (request.url.hostname or "").lower()
    client = request.client.host if request.client else ""
    origin = request.headers.get("origin")
    allowed_hosts = {"127.0.0.1", "localhost", "::1", "testserver"}
    if host not in allowed_hosts or client not in {"127.0.0.1", "::1", "testclient"}:
        return JSONResponse({"error": "DEV yalnız yerel erişime açık"}, status_code=404)
    if origin and origin != f"{request.url.scheme}://{request.headers['host']}":
        return JSONResponse({"error": "Farklı kaynak kabul edilmiyor"}, status_code=403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
        "connect-src 'self'; frame-ancestors 'none'"
    )
    return response


@app.get("/", response_class=HTMLResponse)
def dashboard():
    return page({"manifest": runtime.manifest(), "mode": "live", "api_base": "/dev", "snapshots": {}})


@app.get("/api/manifest")
def manifest():
    return runtime.manifest()


@app.post("/api/run")
async def run(request: Request):
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "application/json":
        raise HTTPException(415, "JSON gerekli")
    size = request.headers.get("content-length")
    if size is not None:
        try:
            if int(size) > 250_000:
                raise HTTPException(413, "Girdi sınırı 250 KB")
        except ValueError as exc:
            raise HTTPException(400, "Geçersiz içerik uzunluğu") from exc
    raw = await request.body()
    if len(raw) > 250_000:
        raise HTTPException(413, "Girdi sınırı 250 KB")
    try:
        body = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Sonlu sayı gerekli")))
        if not isinstance(body, dict) or not isinstance(body.get("lesson"), str) or not isinstance(body.get("input"), dict):
            raise ValueError("lesson ve input nesnesi gerekli")
        check_payload(body["input"])
        return runtime.run(body["lesson"], body["input"])
    except (ValueError, KeyError, TypeError, RecursionError) as exc:
        raise HTTPException(400, str(exc)) from exc
