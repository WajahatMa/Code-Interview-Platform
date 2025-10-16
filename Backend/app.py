from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room
from time import time
from collections import defaultdict
import requests, time as _time

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# -------- In-memory state --------
ROOM_CODE    = {}                 # room -> latest code (string)
ROOM_CHAT    = defaultdict(list)  # room -> [{name,text,ts}]
ROOM_MEMBERS = defaultdict(set)   # room -> set(names)
ROOM_LANG    = {}                 # room -> "python" | "javascript" | "cpp" | "java"
SID_TO_NAME  = {}                 # sid  -> name
SID_TO_ROOM  = {}                 # sid  -> room

# -------- HTTP routes --------
@app.get("/")
def root():
    return "Backend is running!"

@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "backend", "version": 1})

# -------- Piston integration (execute with version) --------
PISTON_BASE = "https://emkc.org/api/v2/piston"
RUNTIMES_CACHE = {"ts": 0, "data": []}
RUNTIMES_TTL = 600  # 10 minutes

def fetch_runtimes():
    now = _time.time()
    if now - RUNTIMES_CACHE["ts"] < RUNTIMES_TTL and RUNTIMES_CACHE["data"]:
        return RUNTIMES_CACHE["data"]
    r = requests.get(f"{PISTON_BASE}/runtimes", timeout=10)
    r.raise_for_status()
    RUNTIMES_CACHE["data"] = r.json()
    RUNTIMES_CACHE["ts"] = now
    return RUNTIMES_CACHE["data"]

def resolve_lang_version(lang_name: str):
    wanted = (lang_name or "").strip().lower()
    if not wanted:
        return None
    runtimes = fetch_runtimes()
    for rt in runtimes:
        if rt.get("language","").lower() == wanted:
            return rt["language"], rt["version"]
    for rt in runtimes:
        if wanted in [a.lower() for a in rt.get("aliases",[])]:
            return rt["language"], rt["version"]
    fallback = {"js":"javascript","node":"javascript","py":"python","c++":"cpp"}
    if wanted in fallback:
        return resolve_lang_version(fallback[wanted])
    return None

@app.post("/api/run")
def api_run():
    try:
        body = request.get_json(force=True, silent=True) or {}
        language = (body.get("language") or "").strip().lower()
        code = body.get("code", "")
        stdin = body.get("stdin", "")
        resolved = resolve_lang_version(language)
        if not resolved:
            return jsonify({"out": "", "err": f"Unsupported language: {language}"}), 400
        lang, version = resolved

        filenames = {
            "javascript":"main.js","python":"main.py","cpp":"main.cpp","java":"Main.java",
            "c":"main.c","cs":"Main.cs","go":"main.go","ruby":"main.rb","rust":"main.rs",
            "php":"main.php","kotlin":"Main.kt","swift":"main.swift"
        }
        name = filenames.get(lang, "main.txt")

        payload = {
            "language": lang,
            "version": version,
            "files": [{"name": name, "content": code}],
            "stdin": stdin or "",
        }

        r = requests.post(f"{PISTON_BASE}/execute", json=payload, timeout=25)
        r.raise_for_status()
        data = r.json() if r.content else {}
        run = data.get("run") or {}
        comp = data.get("compile") or {}
        stdout = run.get("stdout") or ""
        stderr = run.get("stderr") or ""
        cstderr = comp.get("stderr") or ""
        err = (cstderr + ("\n" if cstderr and stderr else "") + stderr).strip()
        return jsonify({"out": stdout, "err": err})

    except requests.exceptions.HTTPError as e:
        try:
            msg = e.response.json().get("message")
        except Exception:
            msg = str(e)
        return jsonify({"out": "", "err": f"Execution service error: {msg}"}), 502
    except requests.exceptions.RequestException as e:
        return jsonify({"out": "", "err": f"Execution service network error: {e}"}), 502
    except Exception as e:
        return jsonify({"out": "", "err": f"Server error: {e}"}), 500

# -------- helpers --------
def unique_name_for_room(room: str, base: str) -> str:
    if base not in ROOM_MEMBERS[room]:
        return base
    i = 2
    while f"{base} ({i})" in ROOM_MEMBERS[room]:
        i += 1
    return f"{base} ({i})"

def normalize_language(lang: str) -> str | None:
    aliases = {"py":"python","python":"python","js":"javascript","javascript":"javascript",
               "c++":"cpp","cpp":"cpp","java":"java"}
    key = (lang or "").strip().lower()
    return aliases.get(key)

# -------- socket.io events --------
@socketio.on("connect")
def on_connect():
    emit("server:hello", {"msg": "connected"})

@socketio.on("join")
def on_join(data):
    room = (data or {}).get("roomId") or "default"
    base = (data or {}).get("name") or f"User-{request.sid[:5]}"
    name = unique_name_for_room(room, base)

    SID_TO_NAME[request.sid] = name
    SID_TO_ROOM[request.sid] = room
    ROOM_MEMBERS[room].add(name)
    if room not in ROOM_LANG:
        ROOM_LANG[room] = "python"  # default

    join_room(room)

    # hydrate JUST the joiner
    emit("room:state", {
        "roomId": room,
        "code": ROOM_CODE.get(room, ""),
        "chat": ROOM_CHAT.get(room, [])[-50:],
        "members": sorted(ROOM_MEMBERS[room]),
        "language": ROOM_LANG.get(room, "python"),
        "you": name,
    })
    # presence to the whole room
    emit("room:presence", {
        "roomId": room,
        "members": sorted(ROOM_MEMBERS[room]),
        "joined": name,
    }, to=room)

@socketio.on("name:update")
def on_name_update(data):
    new_base = (data or {}).get("name", "").strip()
    if not new_base:
        return
    sid  = request.sid
    room = SID_TO_ROOM.get(sid)
    old  = SID_TO_NAME.get(sid)
    if not room or not old:
        return

    ROOM_MEMBERS[room].discard(old)
    new_name = unique_name_for_room(room, new_base)
    ROOM_MEMBERS[room].add(new_name)
    SID_TO_NAME[sid] = new_name

    # private confirmation
    emit("you:renamed", {"name": new_name}, to=sid)
    # presence to room
    emit("room:presence", {
        "roomId": room,
        "members": sorted(ROOM_MEMBERS[room]),
        "renamed": {"from": old, "to": new_name},
    }, to=room)

@socketio.on("chat:send")
def on_chat_send(data):
    room = (data or {}).get("roomId") or SID_TO_ROOM.get(request.sid) or "default"
    raw_text = (data or {}).get("text", "")
    text = raw_text.strip() if isinstance(raw_text, str) else ""
    if not text:
        return
    name = SID_TO_NAME.get(request.sid, f"User-{request.sid[:5]}")
    entry = {"name": name, "text": text, "ts": time()}
    ROOM_CHAT[room].append(entry)
    # broadcast to others (sender shows optimistically)
    emit("chat:recv", entry, to=room, include_self=False)

@socketio.on("code:update")
def code_update(data):
    room = (data or {}).get("roomId") or SID_TO_ROOM.get(request.sid) or "default"
    code = (data or {}).get("code", "")
    ROOM_CODE[room] = code
    emit("code:apply", {"code": code, "roomId": room}, to=room, include_self=False)

@socketio.on("lang:update")
def lang_update(data):
    room = (data or {}).get("roomId") or SID_TO_ROOM.get(request.sid) or "default"
    lang_in = (data or {}).get("language", "")
    norm = normalize_language(lang_in)
    if not norm:
        return
    ROOM_LANG[room] = norm
    emit("lang:apply", {"roomId": room, "language": norm}, to=room)

@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    name = SID_TO_NAME.pop(sid, None)
    room = SID_TO_ROOM.pop(sid, None)
    if not room or not name:
        return
    ROOM_MEMBERS[room].discard(name)
    emit("room:presence", {
        "roomId": room,
        "members": sorted(ROOM_MEMBERS[room]),
        "left": name,
    }, to=room)

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5050, debug=True, use_reloader=False)
