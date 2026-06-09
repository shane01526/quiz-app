"""
Simple server for AWS SAA Quiz App.

Serves static files and provides API endpoints to persist notes & quiz state.

Storage backend:
  - If DATABASE_URL is set (e.g. on Render with a Neon Postgres), state is stored
    in a Postgres table so it survives restarts / redeploys (true persistence).
  - Otherwise it falls back to local JSON files under data/ (handy for local dev,
    no database required).
"""

import http.server
import json
import os

PORT = int(os.environ.get('PORT', 8080))
DATABASE_URL = os.environ.get('DATABASE_URL')

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
FILE_FOR_KEY = {
    'notes': os.path.join(DATA_DIR, 'notes.json'),
    'state': os.path.join(DATA_DIR, 'state.json'),
}

os.makedirs(DATA_DIR, exist_ok=True)


# ===================== STORAGE: Postgres =====================

def _pg_connect():
    import psycopg
    return psycopg.connect(DATABASE_URL)


def _pg_init():
    """Create the key-value table once at startup."""
    with _pg_connect() as conn:
        conn.execute(
            'CREATE TABLE IF NOT EXISTS app_state ('
            '  key TEXT PRIMARY KEY,'
            '  value JSONB NOT NULL'
            ')'
        )
        conn.commit()


def _pg_read(key):
    with _pg_connect() as conn:
        row = conn.execute(
            'SELECT value FROM app_state WHERE key = %s', (key,)
        ).fetchone()
    return row[0] if row else {}


def _pg_write(key, data):
    with _pg_connect() as conn:
        conn.execute(
            'INSERT INTO app_state (key, value) VALUES (%s, %s) '
            'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
            (key, json.dumps(data, ensure_ascii=False)),
        )
        conn.commit()


# ===================== STORAGE: local files =====================

def _file_read(key):
    path = FILE_FOR_KEY[key]
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def _file_write(key, data):
    path = FILE_FOR_KEY[key]
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ===================== STORAGE: dispatch =====================

def read_data(key):
    return _pg_read(key) if DATABASE_URL else _file_read(key)


def write_data(key, data):
    if DATABASE_URL:
        _pg_write(key, data)
    else:
        _file_write(key, data)


class QuizHandler(http.server.SimpleHTTPRequestHandler):

    def do_GET(self):
        if self.path == '/api/notes':
            self._json_response(read_data('notes'))
        elif self.path == '/api/state':
            self._json_response(read_data('state'))
        else:
            super().do_GET()

    def do_POST(self):
        body = self._read_body()
        if self.path == '/api/notes':
            write_data('notes', body)
            self._json_response({'ok': True})
        elif self.path == '/api/state':
            write_data('state', body)
            self._json_response({'ok': True})
        else:
            self.send_error(404)

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        raw = self.rfile.read(length)
        return json.loads(raw) if raw else {}

    def _json_response(self, data):
        payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(payload))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, fmt, *args):
        # Only log API calls, skip static file noise
        if '/api/' in (args[0] if args else ''):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    if DATABASE_URL:
        _pg_init()
        print(f'Quiz server running at http://localhost:{PORT}')
        print('Storage: Postgres (DATABASE_URL) — data is persistent.')
    else:
        print(f'Quiz server running at http://localhost:{PORT}')
        print(f'Storage: local files under {DATA_DIR} (no DATABASE_URL set).')
    httpd = http.server.HTTPServer(('', PORT), QuizHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
