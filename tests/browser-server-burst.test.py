"""The SW shell burst must not exhaust the fixture server's listen queue."""
import ast
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import socket
import unittest


class ServerBurst(unittest.TestCase):
    def test_shell_and_control_connections_can_all_wait_for_accept(self):
        tree = ast.parse(Path(__file__).with_name('run-browser-tests.py').read_text(encoding='utf-8'))
        definition = next(node for node in tree.body
                          if isinstance(node, ast.ClassDef) and node.name == 'BrowserTestServer')
        namespace = {'ThreadingHTTPServer': ThreadingHTTPServer}
        exec(compile(ast.Module(body=[definition], type_ignores=[]), 'fixture-server', 'exec'), namespace)
        server = namespace['BrowserTestServer'](('127.0.0.1', 0), SimpleHTTPRequestHandler)
        clients = []
        try:
            # Hold accept() to model the simultaneous 15-asset install plus
            # its control fetch. The old default queue of five rejects this.
            for _ in range(16):
                client = socket.socket()
                clients.append(client)
                client.settimeout(1)
                client.connect(server.server_address)
            self.assertEqual(len(clients), 16)
        finally:
            for client in clients:
                client.close()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
