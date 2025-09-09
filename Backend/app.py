from flask import Flask, jsonify 
from flask_cors import CORS

app = Flask(__name__)

CORS(app, resources = {r"/*": {"origins": "http://localhost:5173"}})

@app.get("/")

def home(): 
    return "Backend is running!!"

@app.get("/api/health")

def health():   
    return jsonify ({"status" : "ok" , "service": "backend", "version" : 1})

if __name__ == "__main__": 
    app.run(debug = True, port = 5000)
