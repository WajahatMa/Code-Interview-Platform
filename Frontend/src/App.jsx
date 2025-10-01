import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import Editor from "./Editor";

// room from ?room=, default "default"
function getRoomId() {
  const p = new URLSearchParams(window.location.search);
  return p.get("room") || "default";
}

// simple throttle
function useThrottle(ms = 150) {
  const last = useRef(0);
  return () => {
    const now = Date.now();
    if (now - last.current > ms) {
      last.current = now;
      return true;
    }
    return false;
  };
}

export default function App() {
  const [code, setCode] = useState(`# Welcome!
# Edit in one tab; watch it update in another (same ?room=)
print("Hello, world!")`);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");

  // Force WebSocket transport; include credentials for safety
  const socket = useMemo(
    () =>
      io("http://localhost:5050", {
        transports: ["websocket"], // skip long-polling which is failing
        withCredentials: true,
        reconnectionAttempts: 5,
        timeout: 8000,
      }),
    []
  );

  useEffect(() => {
    // diagnostics
    socket.on("connect", () => {
      console.log("✅ Connected to backend. Socket ID:", socket.id);
    });
    socket.on("disconnect", () => console.log("❌ Disconnected"));
    socket.on("connect_error", (err) => console.error("⛔ connect_error:", err));
    socket.on("error", (e) => console.error("socket error:", e));
    socket.on("server:hello", (p) => console.log("👋 server:hello", p));

    // join room
    const roomId = getRoomId();
    console.log("➡️  join", roomId);
    socket.emit("join", { roomId });

    socket.on("joined", ({ roomId }) => console.log("🔐 joined", roomId));

    // chat + code listeners
    socket.on("message", (payload) => {
      console.log("📬 message", payload);
      setMsgs((prev) => [...prev, payload.text]);
    });
    socket.on("code:apply", (payload) => {
      console.log("🪄 code:apply len", (payload?.code || "").length);
      setCode(payload?.code ?? "");
    });

    // test message after 1s
    const t = setTimeout(() => {
      socket.emit("message", { roomId, text: "Hello from this tab 👋" });
    }, 1000);

    return () => {
      clearTimeout(t);
      socket.off("connect");
      socket.off("disconnect");
      socket.off("connect_error");
      socket.off("error");
      socket.off("server:hello");
      socket.off("joined");
      socket.off("message");
      socket.off("code:apply");
    };
  }, [socket]);

  const canSendNow = useThrottle(150);

  const onCodeChange = (next) => {
    setCode(next);
    if (canSendNow()) {
      socket.emit("code:update", { roomId: getRoomId(), code: next });
    }
  };

  const sendChat = () => {
    const text = input.trim();
    if (!text) return;
    socket.emit("message", { roomId: getRoomId(), text });
    setInput("");
  };

  return (
    <main style={{ fontFamily: "system-ui", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Realtime Code (Day 3)</h1>
        <div style={{ fontSize: 14, color: "#555" }}>
          Room: <code>{getRoomId()}</code>
        </div>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 12, marginTop: 12 }}>
        <div>
          <Editor value={code} onChange={onCodeChange} language="python" />
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <strong>Chat</strong>
            <div style={{ marginTop: 8, minHeight: 140 }}>
              {msgs.length === 0 ? <em>No messages yet</em> : msgs.map((m, i) => <div key={i}>• {m}</div>)}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Say hi"
                style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid #ccc" }}
              />
              <button onClick={sendChat} style={{ padding: "8px 12px", borderRadius: 8 }}>Send</button>
            </div>
          </div>
        </aside>
      </section>

      <p style={{ color: "#777", marginTop: 10 }}>
        Open this in two tabs with the same room, e.g. <code>?room=demo</code>.
      </p>
    </main>
  );
}
