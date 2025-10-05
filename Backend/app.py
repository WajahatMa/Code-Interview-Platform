from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room
from time import time
from collections import defaultdict

app = Flask(__name__)

# Dev CORS (tighten for prod)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="eventlet",  # pip install eventlet
)

# -------- In-memory state (MVP) --------
ROOM_CODE    = {}                 # room -> latest code
ROOM_CHAT    = defaultdict(list)  # room -> [{name,text,ts}]
ROOM_MEMBERS = defaultdict(set)   # room -> set(names)
SID_TO_NAME  = {}                 # sid  -> name
SID_TO_ROOM  = {}                 # sid  -> room

# -------- HTTP routes --------
@app.get("/")
def root():
    return "Backend is running!"

@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "backend", "version": 1})

# -------- helpers --------
def unique_name_for_room(room: str, base: str) -> str:
    if base not in ROOM_MEMBERS[room]:
        return base
    i = 2
    while f"{base} ({i})" in ROOM_MEMBERS[room]:
        i += 1
    return f"{base} ({i})"

# -------- socket.io events --------
@socketio.on("connect")
def on_connect():
    print(f"✅ connect {request.sid}")
    emit("server:hello", {"msg": "connected"})

@socketio.on("join")
def on_join(data):
    room = (data or {}).get("roomId") or "default"
    base = (data or {}).get("name") or f"User-{request.sid[:5]}"
    name = unique_name_for_room(room, base)

    SID_TO_NAME[request.sid] = name
    SID_TO_ROOM[request.sid] = room
    ROOM_MEMBERS[room].add(name)
    join_room(room)

    print(f"👥 {request.sid} joined {room} as {name}")

    # hydrate the joiner
    emit("room:state", {
        "roomId": room,
        "code": ROOM_CODE.get(room, ""),
        "chat": ROOM_CHAT.get(room, [])[-50:],  # [{name,text,ts}]
        "members": sorted(ROOM_MEMBERS[room]),
        "you": name,
    })

    # presence to all
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

    emit("you:renamed", {"name": new_name})
    emit("room:presence", {
        "roomId": room,
        "members": sorted(ROOM_MEMBERS[room]),
        "renamed": {"from": old, "to": new_name},
    }, to=room)

@socketio.on("chat:send")
def on_chat_send(data):
    """Client sends {roomId, text}; server stores & broadcasts as chat:recv."""
    room = (data or {}).get("roomId") or SID_TO_ROOM.get(request.sid) or "default"
    raw_text = (data or {}).get("text", "")
    text = raw_text.strip() if isinstance(raw_text, str) else ""
    if not text:
        return
    name = SID_TO_NAME.get(request.sid, f"User-{request.sid[:5]}")
    entry = {"name": name, "text": text, "ts": time()}
    ROOM_CHAT[room].append(entry)

    print(f"💬 [{room}] {name}: {text}")

    # send to everyone else; sender already added message optimistically
    emit("chat:recv", entry, to=room, include_self=False)

@socketio.on("code:update")
def code_update(data):
    room = (data or {}).get("roomId") or SID_TO_ROOM.get(request.sid) or "default"
    code = (data or {}).get("code", "")
    ROOM_CODE[room] = code
    emit("code:apply", {"code": code, "roomId": room}, to=room, include_self=False)

@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    name = SID_TO_NAME.pop(sid, None)
    room = SID_TO_ROOM.pop(sid, None)
    print(f"🔌 disconnect {sid} name={name} room={room}")
    if not room or not name:
        return
    ROOM_MEMBERS[room].discard(name)
    emit("room:presence", {
        "roomId": room,
        "members": sorted(ROOM_MEMBERS[room]),
        "left": name,
    }, to=room)

if __name__ == "__main__":
    # On Windows, use_reloader=False avoids double server in debug
    socketio.run(app, host="0.0.0.0", port=5050, debug=True, use_reloader=False)
