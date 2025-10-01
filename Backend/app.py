from flask import Flask, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room

app = Flask(__name__)

# DEV: allow any origin for HTTP routes (we'll tighten later)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

# DEV: allow any origin for Socket.IO (separate from Flask-CORS!)
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="eventlet"   # ensure: pip install eventlet
)

# -------- HTTP routes --------
@app.get("/")
def home():
    return "Backend is running!"

@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "backend", "version": 1})

# -------- Socket.IO events --------
@socketio.on("connect")
def on_connect():
    print("✅ Client connected")
    emit("server:hello", {"msg": "Connected to Flask-SocketIO"})

@socketio.on("disconnect")
def on_disconnect():
    print("❌ Client disconnected")

@socketio.on("join")
def on_join(data):
    room = (data or {}).get("roomId") or "default"
    print(f"🔗 join requested for room={room}")
    join_room(room)
    emit("joined", {"roomId": room})
    emit("message", {"text": f"A user joined room {room}"}, to=room)

@socketio.on("message")
def on_message(data):
    room = (data or {}).get("roomId") or "default"
    text = (data or {}).get("text", "")
    print(f"💬 message to room={room}: {text!r}")
    if text:
        emit("message", {"text": text}, to=room)

@socketio.on("code:update")
def code_update(data):
    room = (data or {}).get("roomId") or "default"
    code = (data or {}).get("code", "")
    print(f"📝 code:update to room={room} (len={len(code)})")
    emit("code:apply", {"code": code}, to=room, include_self=False)

if __name__ == "__main__":
    # Host 0.0.0.0 avoids localhost/IPv6 oddities on macOS
    socketio.run(app, host="0.0.0.0", port=5050, debug=True)
