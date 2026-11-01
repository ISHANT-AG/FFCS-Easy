"""Development server: always revalidate app files during local editing."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    print('FFCS Easy: http://localhost:5173/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 5173), Handler).serve_forever()
