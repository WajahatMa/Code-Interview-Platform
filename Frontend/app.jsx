import { useEffect, useState } from "react";
import { io } from "socket.io-client";

function App() {
  const [chat, setChat] = useState([]);
  const [input, setInput] = useState("");
  const socket = io("http://127.0.0.1:5000");

  useEffect(() => {
    // Listen for 'message' events from the server
    socket.on("message", (msg) => {
      setChat((prev) => [...prev, msg]);
    });

    // cleanup to avoid duplicate listeners during hot reload
    return () => socket.off("message");
  }, [socket]);

  const send = () => {
    if (input.trim()) {
      socket.emit("message", input);
      setInput("");
    }
  };

  return (
    <main style={{ padding: 24 }}>
      <h1>WebSocket Test Chat</h1>
      <div style={{ marginBottom: 12 }}>
        {chat.map((c, i) => (
          <div key={i}>{c}</div>
        ))}
      </div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type message"
      />
      <button onClick={send}>Send</button>
    </main>
  );
}

export default App;
