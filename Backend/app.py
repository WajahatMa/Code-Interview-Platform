from flask import Flask, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit

app = Flask(__name__)

CORS(app, resources = {r"/*": {"origins": "http://localhost:5173"}})


socketio = SocketIO(app, cors_allowed_origins="*")  # allow our frontend origin

@app.get("/")

def home(): 
    return "Backend is running!!"

@app.get("/api/health")

def health():   
    return jsonify ({"status" : "ok" , "service": "backend", "version" : 1})

@socketio.on("message")
def handle_message(data):
    print("Received message:", data)
    emit("message", data, broadcast=True)


if __name__ == "__main__": 
    socketio.run(app, debug=True, port=5000)


