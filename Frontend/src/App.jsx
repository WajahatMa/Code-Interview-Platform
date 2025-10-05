// App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import Editor from "./Editor.jsx"; // adjust path if needed

// ---------- socket singleton ----------
const socket = io("http://localhost:5050", {
  transports: ["websocket"],
  withCredentials: true,
  autoConnect: true,
});

// ---------- helpers ----------
function getRoomId() {
  const p = new URLSearchParams(window.location.search);
  return p.get("room") || "default";
}
function getInitialName() {
  const p = new URLSearchParams(window.location.search);
  const fromURL = p.get("name");
  if (fromURL && fromURL.trim()) return fromURL.trim();

  const saved = localStorage.getItem("mu_name");
  if (saved && saved.trim()) return saved.trim();

  const entered = window.prompt("Enter a display name:", "");
  const name =
    entered && entered.trim()
      ? entered.trim()
      : `User-${Math.random().toString(36).slice(2, 6)}`;
  localStorage.setItem("mu_name", name);
  return name;
}

// ---------- component ----------
export default function App() {
  const roomId = useMemo(() => getRoomId(), []);
  const [connected, setConnected] = useState(false);
  const [name, setName] = useState(getInitialName());
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]); // [{name,text,ts}]
  const chatInputRef = useRef(null);

  useEffect(() => {
    // ---- handlers ----
    const onConnect = () => {
      setConnected(true);
      socket.emit("join", { roomId, name });
      console.log("[socket] connected; join", roomId, "as", name);
    };
    const onDisconnect = () => {
      setConnected(false);
      console.log("[socket] disconnected");
    };
    const onRoomState = (s) => {
      console.log("[socket] room:state", s);
      if (s?.you && s.you !== name) {
        setName(s.you);
        localStorage.setItem("mu_name", s.you);
      }
      if (Array.isArray(s?.members)) setMembers(s.members);
      if (Array.isArray(s?.chat)) setMessages(s.chat);
    };
    const onPresence = (p) => {
      console.log("[socket] room:presence", p);
      if (Array.isArray(p?.members)) setMembers(p.members);
    };
    const onChatRecv = (payload) => {
      console.log("[socket] chat:recv", payload);
      if (payload && typeof payload.text === "string" && payload.text.length) {
        setMessages((prev) => [...prev, payload]);
      }
    };
    const onYouRenamed = (p) => {
      console.log("[socket] you:renamed", p);
      if (p?.name) {
        setName(p.name);
        localStorage.setItem("mu_name", p.name);
      }
    };

    // ---- wire ----
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onRoomState);
    socket.on("room:presence", onPresence);
    socket.on("chat:recv", onChatRecv);
    socket.on("you:renamed", onYouRenamed);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onRoomState);
      socket.off("room:presence", onPresence);
      socket.off("chat:recv", onChatRecv);
      socket.off("you:renamed", onYouRenamed);
    };
  }, [roomId, name]);

  // ---- chat ----
  const sendChat = () => {
    const text = chatInputRef.current?.value?.trim();
    if (!text) return;

    // 1) optimistic local echo
    const entry = { name, text, ts: Date.now() / 1000 };
    setMessages((prev) => [...prev, entry]);

    // 2) tell server (which will broadcast to others)
    socket.emit("chat:send", { roomId, text });

    chatInputRef.current.value = "";
  };

  // ---- rename ----
  const rename = () => {
    const next = window.prompt("Choose a new display name:", name);
    if (!next) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === name) return;
    socket.emit("name:update", { name: trimmed });
    // final name comes via you:renamed + room:presence
  };

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "grid",
        gridTemplateColumns: "1fr 340px",
        gridTemplateRows: "auto 1fr",
        gridTemplateAreas: `
          "topbar  topbar"
          "editor  sidebar"
        `,
      }}
    >
      {/* Topbar */}
      <div
        style={{
          gridArea: "topbar",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid #e5e5e5",
          background: "#fafafa",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <strong>Multi-User Code Interview Platform</strong>
          <span>
            Room: <code>{roomId}</code>
          </span>
          <span>
            Status:{" "}
            <span title={connected ? "Connected" : "Disconnected"}>
              {connected ? "🟢 connected" : "⚪️ offline"}
            </span>
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => navigator.clipboard?.writeText(window.location.href)}
          >
            Copy Invite Link
          </button>
          <button onClick={rename}>Rename</button>
        </div>
      </div>

      {/* Editor */}
      <div style={{ gridArea: "editor", minWidth: 0, minHeight: 0 }}>
        <Editor roomId={roomId} />
      </div>

      {/* Sidebar */}
      <div
        style={{
          gridArea: "sidebar",
          borderLeft: "1px solid #e5e5e5",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div style={{ padding: 12, borderBottom: "1px solid #eee" }}>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>
            You: <code>{name}</code>
          </div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>In room:</div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              maxHeight: 140,
              overflowY: "auto",
            }}
          >
            {members.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>

        <div
          style={{
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minHeight: 0,
            height: "100%",
          }}
        >
          <div style={{ fontWeight: 600 }}>Chat</div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              border: "1px solid #eee",
              borderRadius: 6,
              padding: 8,
              background: "#fff",
            }}
          >
            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <b>{m.name || "User"}</b>: {m.text}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={chatInputRef}
              placeholder="Type a message"
              style={{ flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendChat();
              }}
            />
            <button onClick={sendChat}>Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}
