from flask import Flask, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room

app = Flask(__name__)

# Let the React dev server (5173) call HTTP routes
CORS(app, resources={r"/*": {"origins": "http://localhost:5173"}})

# Socket.IO server (WebSockets). In dev, allow our frontend origin.
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

@app.get("/")
def home():
    return "Backend is running!"

@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "backend", "version": 1})

# ---- WebSocket events ----

@socketio.on("connect")
def on_connect():
    # Optional: confirm a socket connected (shows in backend logs)
    print("Client connected")

@socketio.on("join")
def on_join(data):
    """Client joins a logical room, e.g., ?room=demo"""
    room = (data or {}).get("roomId") or "default"
    join_room(room)
    emit("joined", {"roomId": room})

@socketio.on("message")
def on_message(data):
    """
    Broadcast a chat message to everyone in the same room.
    Payload shape we expect: { roomId, text }
    """
    room = (data or {}).get("roomId") or "default"
    text = (data or {}).get("text", "")
    if text:
        emit("message", {"text": text}, to=room)

if __name__ == "__main__":
    # socketio.run enables WebSockets; eventlet gives us a production-like dev server
    socketio.run(app, debug=True, port=5000)
