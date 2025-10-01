import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

// Helper: get ?room= from URL (defaults to "default")
function getRoomId() {
  const p = new URLSearchParams(window.location.search);
  return p.get("room") || "default";
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  // Create socket only once (useMemo ensures this)
  const socket = useMemo(() => io("http://127.0.0.1:5000"), []);

  useEffect(() => {
    // Join a room
    socket.emit("join", { roomId: getRoomId() });

    // Listen for confirmation
    socket.on("joined", ({ roomId }) => {
      console.log("Joined room:", roomId);
    });

    // Listen for messages
    socket.on("message", (payload) => {
      setMessages((prev) => [...prev, payload.text]);
    });

    // Cleanup listeners if hot reloaded
    return () => {
      socket.off("joined");
      socket.off("message");
    };
  }, [socket]);

  // Send a message
  const send = () => {
    const text = input.trim();
    if (!text) return;
    socket.emit("message", { roomId: getRoomId(), text });
    setInput("");
  };

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 720 }}>
      <h1>Realtime Chat (Day 2 MVP)</h1>

      <div
        style={{
          margin: "12px 0",
          padding: 12,
          border: "1px solid #ddd",
          borderRadius: 8,
          minHeight: 120,
        }}
      >
        {messages.length === 0 ? (
          <em>No messages yet</em>
        ) : (
          messages.map((m, i) => <div key={i}>• {m}</div>)
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message"
          style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid #ccc" }}
        />
        <button onClick={send} style={{ padding: "8px 14px", borderRadius: 8 }}>
          Send
        </button>
      </div>

      <p style={{ marginTop: 10, color: "#666" }}>
        Tip: open this page in two tabs with the same room, e.g.{" "}
        <code>?room=demo</code>
      </p>
    </main>
  );
}
