#!/usr/bin/env python3
# KnightCat Endless Run - yerel sunucu (internet gerekmez). Mac / Linux / Windows (Python 3 ile).
import http.server, os, socketserver, sys, webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
TYPES = {'.wasm': 'application/wasm', '.data': 'application/octet-stream', '.tflite': 'application/octet-stream',
         '.binarypb': 'application/octet-stream', '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css'}

class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TYPES}
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self): self.send_header('Cache-Control', 'no-cache'); super().end_headers()
    def log_message(self, *a): pass

for port in (8080, 8081, 8090, 8765, 9000, 5500):
    try:
        srv = socketserver.ThreadingTCPServer(('localhost', port), H); break
    except OSError:
        continue
else:
    sys.exit('Bos port bulunamadi.')

url = f'http://localhost:{port}/index.html'
print(f'\n  KnightCat Endless Run calisiyor\n  Adres: {url}\n  Kapatmak icin Ctrl+C\n')
webbrowser.open(url)
try: srv.serve_forever()
except KeyboardInterrupt: pass
