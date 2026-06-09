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

## Storage / persistence

The server stores quiz progress and notes through `/api/state` and `/api/notes`:

- **With `DATABASE_URL` set** → stored in a Postgres database (a single
  `app_state` key-value table). Data is **persistent** across restarts/redeploys.
- **Without `DATABASE_URL`** → falls back to local JSON files under `data/`
  (convenient for local dev, no database needed).

## Deploy on Render (with persistent storage via Neon)

### 1. Create a free Postgres database on Neon

1. Sign up at [neon.tech](https://neon.tech) and create a project.
2. Copy the **connection string** (looks like
   `postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require`).

### 2. Deploy on Render

1. On [Render](https://render.com): New → **Blueprint**, connect this GitHub repo.
2. Render reads `render.yaml`, installs `requirements.txt`, and creates a Python
   web service. `server.py` binds to the `PORT` env var Render provides.
3. In the service's **Environment** settings, add the env var
   **`DATABASE_URL`** and paste the Neon connection string from step 1.
4. Deploy. The table is auto-created on first start.

Now progress survives redeploys and restarts — true persistence. ✅

> Note: this app keeps a **single global state** (no per-user accounts); everyone
> shares the same progress. The frontend also caches to localStorage as a fast
> local copy.
