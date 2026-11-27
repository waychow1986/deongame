#!/usr/bin/env bash
# 探测 PostgreSQL 依赖：连通性 + 用注入的凭据认证 + 执行 SELECT 1。
# 只使用平台探测环境提供的工具（bash、python3）；不输出任何机密。
set -euo pipefail

: "${AIDH_PROBE_RESULT:?AIDH_PROBE_RESULT is required}"

python3 -I - <<'PY'
import base64, hashlib, hmac, json, os, secrets, socket, ssl, struct

out_path = os.environ["AIDH_PROBE_RESULT"]
result = {"reachable": False, "authenticated": False, "results": []}

def write():
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f)

addr = os.environ.get("AIDH_DEP_POSTGRES_ADDRESS", "")
user = os.environ.get("AIDH_DEP_POSTGRES_USER", "")
password = os.environ.get("AIDH_DEP_POSTGRES_PASSWORD", "")
database = os.environ.get("AIDH_DEP_POSTGRES_DATABASE", "")
sslmode = (os.environ.get("AIDH_DEP_POSTGRES_SSLMODE", "disable") or "disable").lower()

host, _, port = addr.rpartition(":")
if not host or not port.isdigit():
    write(); raise SystemExit(0)

class AuthFailed(Exception):
    pass

def recv_exact(s, n):
    buf = b""
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("connection closed")
        buf += chunk
    return buf

def read_msg(s):
    t = recv_exact(s, 1)
    (length,) = struct.unpack("!I", recv_exact(s, 4))
    return t, recv_exact(s, length - 4)

def send(s, t, payload):
    s.sendall(t + struct.pack("!I", len(payload) + 4) + payload)

def error_code(body):
    for field in body.split(b"\x00"):
        if field[:1] == b"C":
            return field[1:].decode()
    return ""

try:
    s = socket.create_connection((host, int(port)), timeout=10)
except OSError:
    write(); raise SystemExit(0)
result["reachable"] = True

try:
    if sslmode in ("require", "verify-ca", "verify-full"):  # libpq 语义：require 只加密不校验证书
        s.sendall(struct.pack("!II", 8, 80877103))
        if recv_exact(s, 1) != b"S":
            raise ConnectionError("server refused SSL")
        ctx = ssl.create_default_context()
        if sslmode == "require":
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        s = ctx.wrap_socket(s, server_hostname=host)

    params = b"user\x00" + user.encode() + b"\x00database\x00" + database.encode() + b"\x00\x00"
    s.sendall(struct.pack("!II", len(params) + 8, 196608) + params)

    client_first_bare = server_first = None
    salted = None
    while True:
        t, body = read_msg(s)
        if t == b"E":
            code = error_code(body)
            if code.startswith("28") or code == "3D000":
                raise AuthFailed(code)
            raise ConnectionError(code)
        if t == b"R":
            (kind,) = struct.unpack("!I", body[:4])
            if kind == 0:
                continue
            if kind == 3:
                send(s, b"p", password.encode() + b"\x00")
            elif kind == 5:
                inner = hashlib.md5(password.encode() + user.encode()).hexdigest()
                digest = hashlib.md5(inner.encode() + body[4:8]).hexdigest()
                send(s, b"p", b"md5" + digest.encode() + b"\x00")
            elif kind == 10:
                nonce = base64.b64encode(secrets.token_bytes(18)).decode()
                client_first_bare = "n=,r=" + nonce
                msg = ("n,," + client_first_bare).encode()
                send(s, b"p", b"SCRAM-SHA-256\x00" + struct.pack("!I", len(msg)) + msg)
            elif kind == 11:
                server_first = body[4:].decode()
                attrs = dict(kv.split("=", 1) for kv in server_first.split(","))
                salted = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(attrs["s"]), int(attrs["i"]))
                client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
                stored_key = hashlib.sha256(client_key).digest()
                without_proof = "c=biws,r=" + attrs["r"]
                auth_msg = ",".join([client_first_bare, server_first, without_proof]).encode()
                sig = hmac.new(stored_key, auth_msg, hashlib.sha256).digest()
                proof = bytes(a ^ b for a, b in zip(client_key, sig))
                send(s, b"p", (without_proof + ",p=" + base64.b64encode(proof).decode()).encode())
            elif kind == 12:
                continue
            else:
                raise ConnectionError("unsupported auth method %d" % kind)
        elif t == b"Z":
            break
    result["authenticated"] = True

    send(s, b"Q", b"SELECT 1\x00")
    while True:
        t, body = read_msg(s)
        if t == b"E":
            raise ConnectionError(error_code(body))
        if t == b"Z":
            break
    send(s, b"X", b"")
except AuthFailed:
    result["authenticated"] = False
except Exception:
    pass
finally:
    try:
        s.close()
    except Exception:
        pass

write()
PY
