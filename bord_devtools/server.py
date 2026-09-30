#!/usr/bin/env python3
"""Loopback-only laboratory. Does not import app.py or initialize the app DB."""
import argparse
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
from urllib.parse import urlparse
import webbrowser
from . import runtime

HERE = Path(__file__).resolve().parent

def page(bundle):
    template=(HERE/'template.html').read_text()
    payload=json.dumps(bundle,ensure_ascii=False,allow_nan=False).replace('<','\\u003c')
    return (template.replace('/* LAB_STYLE */',(HERE/'style.css').read_text())
            .replace('/* BORD_STYLE */',(HERE/'bord-theme.css').read_text())
            .replace('/* LAB_DATA */','window.LAB='+payload+';')
            .replace('/* LAB_SCRIPT */',(HERE/'dashboard.js').read_text()))

def check_payload(value, depth=0, budget=None):
    budget = budget if budget is not None else [12000]
    budget[0]-=1
    if budget[0]<0 or depth>35: raise ValueError('Deney girdisi çok büyük/derin; küçük bir vaka kullanın.')
    if isinstance(value,dict):
        for v in value.values():check_payload(v,depth+1,budget)
    elif isinstance(value,list):
        for v in value:check_payload(v,depth+1,budget)

class Handler(BaseHTTPRequestHandler):
    def send(self,status,value,html=False):
        raw=(value if html else json.dumps(value,ensure_ascii=False,allow_nan=False)).encode()
        self.send_response(status)
        self.send_header('Content-Type','text/html; charset=utf-8' if html else 'application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(raw)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
        self.end_headers();self.wfile.write(raw)
    def allowed(self):
        hosts={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
        return self.headers.get('Host') in hosts and (not self.headers.get('Origin') or self.headers.get('Origin') in {'http://'+x for x in hosts})
    def do_GET(self):
        if not self.allowed():return self.send(403,{'error':'Yalnız yerel laboratuvar kaynağına izin verilir.'})
        path=urlparse(self.path).path
        if path=='/':return self.send(200,page({'manifest':runtime.manifest(),'mode':'live','snapshots':{}}),True)
        if path=='/api/manifest':return self.send(200,runtime.manifest())
        return self.send(404,{'error':'Bulunamadı'})
    def do_POST(self):
        if not self.allowed():return self.send(403,{'error':'Geçersiz kaynak'})
        if self.path!='/api/run':return self.send(404,{'error':'Bulunamadı'})
        if self.headers.get_content_type()!='application/json':return self.send(415,{'error':'JSON gerekli'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=250000:raise ValueError('Girdi sınırı 250 KB.')
            body=json.loads(self.rfile.read(size),parse_constant=lambda x: (_ for _ in ()).throw(ValueError('Sonlu sayı gerekli')))
            if not isinstance(body,dict) or not isinstance(body.get('input'),dict):raise ValueError('input nesne olmalı')
            check_payload(body['input'])
            result=runtime.run(body['lesson'],body['input'])
            self.send(200,result)
        except (ValueError,KeyError,TypeError,RecursionError) as exc:self.send(400,{'error':str(exc)})

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--open',action='store_true');parser.add_argument('--port',type=int,default=8768)
    args=parser.parse_args()
    server=HTTPServer(('127.0.0.1',args.port),Handler)
    url=f'http://127.0.0.1:{args.port}'
    print(f'BORD Akış Laboratuvarı: {url}',flush=True)
    if args.open:webbrowser.open(url)
    try:server.serve_forever()
    except KeyboardInterrupt:server.server_close()
