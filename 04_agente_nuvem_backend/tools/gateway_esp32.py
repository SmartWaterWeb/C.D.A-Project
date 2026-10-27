#!/usr/bin/env python3
"""Gateway limitado para o ESP32; nao simula telemetria nem armazena leituras.

Escuta somente loopback. Cloudflared fornece HTTPS; PANEL_KEY continua obrigatoria.
Usa cabecalhos pequenos na rede local para respeitar o parser embarcado.
"""
import argparse
import hmac
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import re
import socket
from pathlib import Path
import threading
import time
from urllib.parse import urlsplit

ASSETS = {'/', '/index.html', '/app.css', '/app.js', '/manifest.json',
          '/service-worker.js', '/icon.svg', '/icon-192.png', '/icon-512.png'}
GET_API = {'/api/info', '/api/status', '/api/calibracao', '/api/eventos', '/api/comando', '/api/instalacao'}
POST_API = {'/api/auth', '/api/bomba', '/api/calibracao', '/api/telegram/test',
            '/api/teste/cenario', '/api/instalacao'}


class Installation:
    """Configuracao de uma instalacao, independente do binario e do navegador."""
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()
        self.data = {'nome_condominio': 'Meu condominio', 'https_desejado': '',
                     'https_ativo': '', 'estado_https': 'pendente'}
        if self.path.exists():
            self.data.update(json.loads(self.path.read_text(encoding='utf-8')))
        # O endereco anterior nao e apresentado como ativo apos reiniciar.
        self.data['https_ativo'] = ''
        self.data['estado_https'] = 'pendente'

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(self.path)

    def update(self, data):
        if set(data) != {'nome_condominio', 'https_desejado'}:
            raise ValueError('Informe nome e endereco HTTPS.')
        name, url = data['nome_condominio'], data['https_desejado']
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or any(ord(c) < 32 for c in name):
            raise ValueError('Nome deve conter de 1 a 80 caracteres.')
        if not isinstance(url, str) or len(url) > 260:
            raise ValueError('Endereco HTTPS invalido.')
        url = url.strip()
        if url:
            p = urlsplit(url)
            host = p.hostname or ''
            if (p.scheme != 'https' or p.username or p.password or p.port not in (None, 443)
                    or p.path not in ('', '/') or p.query or p.fragment
                    or not re.fullmatch(r'(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}', host)):
                raise ValueError('Use https://painel.seu-dominio.com.br, sem caminho ou senha.')
            url = 'https://' + host.lower()
        with self.lock:
            self.data.update(nome_condominio=name.strip(), https_desejado=url)
            active = self.data['https_ativo']
            self.data['estado_https'] = ('ativo' if url and url == active else
                                         'pendente' if url else 'temporario' if active else 'pendente')
            self.save()
            return dict(self.data)

    def snapshot(self):
        with self.lock:
            return dict(self.data)

    def activate(self, url):
        with self.lock:
            self.data['https_ativo'] = url
            self.data['estado_https'] = ('ativo' if url == self.data['https_desejado'] else
                                         'pendente' if self.data['https_desejado'] else 'temporario')
            self.save()


def local_origin(value):
    parsed = urlsplit(value if '://' in value else 'http://' + value)
    address = ipaddress.IPv4Address(parsed.hostname or '')
    if (parsed.scheme != 'http' or not address.is_private or address.is_loopback
            or address.is_unspecified or address.is_multicast or parsed.username
            or parsed.password or parsed.path not in ('', '/') or parsed.query
            or parsed.fragment or parsed.port not in (None, 80)):
        raise ValueError('Informe o IPv4 privado do ESP32, porta 80.')
    return str(address)


class Device:
    def __init__(self, host, key, profile, identity=None):
        if len(key) < 32 or not key.isascii():
            raise ValueError('A chave do gateway precisa de pelo menos 32 caracteres ASCII.')
        if profile not in ('real', 'teste'):
            raise ValueError('Perfil deve ser real ou teste.')
        self.host, self.key, self.profile = local_origin(host), key, profile
        self.lock = threading.Lock()
        self.identity = identity

    def request(self, method, path, body=None, authenticated=False):
        started = time.monotonic()
        connection = http.client.HTTPConnection(self.host, 80, timeout=5)
        deadline = None
        headers = {'Connection': 'close', 'Accept-Encoding': 'gzip'}
        if authenticated:
            headers['X-API-Key'] = self.key
        if body is not None:
            headers['Content-Type'] = 'application/json'
        try:
            connection.connect()
            upstream_socket = connection.sock
            def abort():
                try:
                    upstream_socket.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            deadline = threading.Timer(max(0.01, 8 - (time.monotonic() - started)), abort)
            deadline.daemon = True
            deadline.start()
            connection.request(method, path, body, headers)
            response = connection.getresponse()
            data = response.read(262145)
            if len(data) > 262144:
                raise ValueError('Resposta do dispositivo excede limite.')
            return response.status, response.getheaders(), data
        finally:
            if deadline:
                deadline.cancel()
            connection.close()

    def verify(self):
        code, _, data = self.request('GET', '/api/info')
        info = json.loads(data)
        identity = info.get('dispositivo_id')
        if (code != 200 or info.get('ambiente') != 'ESP32' or not isinstance(identity, str)
                or not re.fullmatch(r'[0-9A-Fa-f]{12,16}', identity)
                or info.get('perfil') != self.profile
                or bool(info.get('dados_sinteticos')) != (self.profile == 'teste')
                or (self.identity and identity != self.identity)):
            raise ValueError('Dispositivo/perfil diverge da configuracao. Acesso bloqueado.')
        self.identity = identity
        return info


class Gateway(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, device, installation=None):
        self.device = device
        self.installation = installation
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(address, Handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            try:
                request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = 'SmartConnect'
    sys_version = ''

    def setup(self):
        super().setup()
        self.connection.settimeout(6)

    def log_message(self, *args):
        pass  # URLs, headers e credenciais nao entram em logs.

    def error(self, code, message):
        self.reply(code, [('Content-Type', 'application/json')],
                   json.dumps({'erro': message}).encode())

    def reply(self, code, headers, body):
        self.send_response(code)
        allowed = {'content-type', 'content-encoding', 'content-security-policy',
                   'x-content-type-options', 'retry-after'}
        for name, value in headers:
            if name.lower() in allowed:
                self.send_header(name, value)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def do_GET(self):
        self.forward()

    def do_POST(self):
        self.forward()

    def forward(self):
        parsed = urlsplit(self.path)
        path = parsed.path
        if (parsed.scheme or parsed.netloc or len(self.path) > 127
                or len(str(self.headers)) > 16384 or parsed.fragment):
            return self.error(400, 'Requisicao invalida.')
        if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) > 1:
            return self.error(400, 'Corpo HTTP invalido.')
        allowed = ASSETS | GET_API if self.command == 'GET' else POST_API
        if path not in allowed:
            return self.error(404, 'Rota nao encontrada.')
        device = self.server.device
        if path == '/api/teste/cenario' and device.profile != 'teste':
            return self.error(404, 'Rota nao encontrada.')
        authenticated = path.startswith('/api/') and path != '/api/info'
        if authenticated:
            keys = self.headers.get_all('X-API-Key', [])
            if len(keys) != 1 or not hmac.compare_digest(keys[0].encode(), device.key.encode()):
                return self.error(401, 'Chave de acesso invalida ou ausente.')
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return self.error(400, 'Tamanho invalido.')
        if length < 0 or length > 2048 or (self.command == 'GET' and length):
            return self.error(413, 'Corpo muito grande ou inesperado.')
        if self.command == 'POST' and self.headers.get_content_type() != 'application/json':
            return self.error(415, 'Use application/json.')
        body = self.rfile.read(length) if self.command == 'POST' else None
        if body is not None and len(body) != length:
            return self.error(400, 'Corpo incompleto.')
        if path == '/api/instalacao':
            installation = self.server.installation
            if installation is None:
                return self.error(404, 'Configuracao de instalacao indisponivel.')
            try:
                data = installation.update(json.loads(body)) if body is not None else installation.snapshot()
            except (ValueError, TypeError, AttributeError):
                return self.error(400, 'Nome ou endereco HTTPS invalido. Use um dominio HTTPS sem caminho.')
            return self.reply(200, [('Content-Type', 'application/json')], json.dumps(data).encode())
        if not device.lock.acquire(timeout=2):
            return self.error(503, 'Controlador ocupado. Tente novamente.')
        try:
            # Identidade e perfil conferidos antes de cada operacao autenticada.
            if authenticated or path == '/api/info':
                device.verify()
            code, headers, data = device.request(self.command, self.path, body, authenticated)
            if path == '/api/info' and code == 200 and self.server.installation:
                info = json.loads(data)
                info.setdefault('capacidades', {})['configuracao_acesso'] = True
                info['nome_condominio'] = self.server.installation.snapshot()['nome_condominio']
                data = json.dumps(info).encode()
        except (OSError, ValueError, http.client.HTTPException):
            return self.error(502, 'ESP32 indisponivel ou identidade/perfil divergente.')
        finally:
            device.lock.release()
        self.reply(code, headers, data)


def load_device(access_file, profile, ip=None):
    access = json.loads(Path(access_file).read_text(encoding='utf-8-sig'))
    device = Device(ip or access['local_url'], access['api_key'], profile,
                    access.get('dispositivo_id'))
    device.verify()
    code, _, body = device.request('POST', '/api/auth', b'{}', True)
    if code != 200 or not json.loads(body).get('autenticado'):
        raise ValueError('Chave do arquivo nao corresponde ao ESP32.')
    return device


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--access-file', required=True)
    parser.add_argument('--profile', choices=['teste', 'real'], required=True)
    parser.add_argument('--ip')
    parser.add_argument('--port', type=int, default=8089)
    args = parser.parse_args()
    device = load_device(args.access_file, args.profile, args.ip)
    print(f'ESP32 {device.identity}, perfil {device.profile}; gateway 127.0.0.1:{args.port}', flush=True)
    with Gateway(('127.0.0.1', args.port), device) as gateway:
        try:
            gateway.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
