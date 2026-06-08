"""
Simple server for AWS SAA Quiz App.
Serves static files and provides API endpoints to persist notes & quiz state to local JSON files.
"""

import http.server
import json
import os
import sys

PORT = int(os.environ.get('PORT', 8080))
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
NOTES_FILE = os.path.join(DATA_DIR, 'notes.json')
STATE_FILE = os.path.join(DATA_DIR, 'state.json')

os.makedirs(DATA_DIR, exist_ok=True)


def read_json(path):
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def write_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


class QuizHandler(http.server.SimpleHTTPRequestHandler):

    def do_GET(self):
        if self.path == '/api/notes':
            self._json_response(read_json(NOTES_FILE))
        elif self.path == '/api/state':
            self._json_response(read_json(STATE_FILE))
        else:
            super().do_GET()

    def do_POST(self):
        body = self._read_body()
        if self.path == '/api/notes':
            write_json(NOTES_FILE, body)
            self._json_response({'ok': True})
        elif self.path == '/api/state':
            write_json(STATE_FILE, body)
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
    print(f'Quiz server running at http://localhost:{PORT}')
    print(f'Notes saved to: {NOTES_FILE}')
    print(f'State saved to: {STATE_FILE}')
    httpd = http.server.HTTPServer(('', PORT), QuizHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
