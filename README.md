# AWS SAA Quiz App

A self-contained quiz app for AWS Solutions Architect Associate (SAA-C03) practice,
with a built-in AI tutor (OpenAI / Anthropic / Gemini / Ollama).

## Run locally

```bash
python server.py
# → http://localhost:8080
```

No dependencies — uses only the Python standard library.

## AI tutor

Open the **API 設定** panel in the right sidebar, choose a provider, paste your API
key, pick a model, and click 儲存. The key is stored in your browser's localStorage
and the request goes directly from the browser to the provider.

## Deploy on Render

This repo includes `render.yaml`. On [Render](https://render.com):

1. New → **Blueprint**, connect this GitHub repo.
2. Render reads `render.yaml` and creates a Python web service.
3. `server.py` binds to the `PORT` env var Render provides automatically.

> **Note:** Render's free tier has an *ephemeral* filesystem. Quiz progress and
> notes saved via `/api/state` and `/api/notes` are written to local JSON files
> and will be **reset on each deploy/restart**. Per-browser state still works
> because the frontend also caches to localStorage.
