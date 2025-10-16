// App.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import Editor from "./Editor.jsx";

// ---------- ONE shared socket per tab ----------
const socket = io("http://localhost:5050", {
  transports: ["websocket"],
  withCredentials: true,
  autoConnect: true,
});

// ---------- Pyodide helpers ----------
let pyodideReady;
async function ensurePyodide() {
  if (!window.loadPyodide) throw new Error("Pyodide script not loaded");
  if (!pyodideReady) pyodideReady = window.loadPyodide();
  return pyodideReady;
}
async function runPythonLocal(code) {
  const py = await ensurePyodide();
  const safe = code.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
  const wrapped = `
import sys, io
buf_out, buf_err = io.StringIO(), io.StringIO()
__o, __e = sys.stdout, sys.stderr
sys.stdout, sys.stderr = buf_out, buf_err
try:
    exec("""${safe}""", {})
finally:
    sys.stdout, sys.stderr = __o, __e
__out, __err = buf_out.getvalue(), buf_err.getvalue()
`;
  await py.runPythonAsync(wrapped);
  const out = String(py.globals.get("__out") || "");
  const err = String(py.globals.get("__err") || "");
  try { py.globals.delete("__out"); py.globals.delete("__err"); } catch { }
  return { out, err };
}

// ---------- helpers ----------
function getRoomId() {
  const p = new URLSearchParams(window.location.search);
  return p.get("room") || "default";
}
function getStoredName() {
  const p = new URLSearchParams(window.location.search);
  const fromURL = p.get("name");
  if (fromURL && fromURL.trim()) return fromURL.trim();
  const saved = localStorage.getItem("mu_name");
  if (saved && saved.trim()) return saved.trim();
  return "";
}

// ---------- Name modal ----------
function NameModal({ initial, onSubmit }) {
  const [val, setVal] = useState(initial || "");
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      display: "grid", placeItems: "center", zIndex: 50
    }}>
      <div style={{
        width: 360, background: "var(--panel)", color: "var(--text)",
        border: "1px solid var(--line)", borderRadius: 12, padding: 18,
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)"
      }}>
        <h3 style={{ marginTop: 0 }}>Choose a display name</h3>
        <p style={{ marginTop: 0, color: "var(--muted)" }}>
          This name will be visible to others in the room.
        </p>
        <input
          value={val}
          onChange={e => setVal(e.target.value)}
          placeholder="e.g. Waj"
          style={{ width: "100%", margin: "8px 0 12px" }}
          onKeyDown={(e) => { if (e.key === "Enter") { onSubmit(val.trim() || null); } }}
          autoFocus
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={() => onSubmit(null)}>Cancel</button>
          <button onClick={() => onSubmit(val.trim() || null)}>Join</button>
        </div>
      </div>
    </div>
  );
}

// ---------- component ----------
export default function App() {
  const roomId = useMemo(() => getRoomId(), []);
  const [connected, setConnected] = useState(false);

  // Always prompt on new tab
  const [needsName, setNeedsName] = useState(true);
  const [name, setName] = useState(getStoredName());
  const hasJoinedRef = useRef(false);

  // presence + chat
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const chatInputRef = useRef(null);

  // editor/run
  const [language, setLanguage] = useState("python"); // hydrated by server
  const latestCodeRef = useRef("");
  const [runOutput, setRunOutput] = useState("");

  // Stable onChange (prevents Editor remount)
  const handleEditorChange = useCallback((code) => {
    latestCodeRef.current = code;
  }, []);

  // ---- socket lifecycle & events ----
  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    const onRoomState = (s) => {
      if (s?.you && s.you !== name) {
        setName(s.you);
        localStorage.setItem("mu_name", s.you);
      }
      if (Array.isArray(s?.members)) setMembers(s.members);
      if (Array.isArray(s?.chat)) setMessages(s.chat);
      if (s?.language) setLanguage(s.language);
    };

    const onPresence = (p) => {
      if (Array.isArray(p?.members)) setMembers(p.members);
    };

    const onChatRecv = (payload) => {
      if (payload && typeof payload.text === "string" && payload.text.length) {
        setMessages((prev) => [...prev, payload]);
      }
    };

    const onLangApply = (p) => {
      if (!p || p.roomId !== roomId) return;
      setLanguage(p.language);
    };

    const onYouRenamed = (p) => {
      if (p?.name) {
        setName(p.name);
        localStorage.setItem("mu_name", p.name);
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onRoomState);
    socket.on("room:presence", onPresence);
    socket.on("chat:recv", onChatRecv);
    socket.on("lang:apply", onLangApply);
    socket.on("you:renamed", onYouRenamed);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onRoomState);
      socket.off("room:presence", onPresence);
      socket.off("chat:recv", onChatRecv);
      socket.off("lang:apply", onLangApply);
      socket.off("you:renamed", onYouRenamed);
    };
    // bind once; state gets updated inside handlers
  }, [roomId]); // <— important: do NOT depend on `name` here

  // ---- join only after we have a confirmed name ----
  useEffect(() => {
    if (!connected) return;
    if (needsName) return;
    if (!name || hasJoinedRef.current) return;
    hasJoinedRef.current = true;
    socket.emit("join", { roomId, name });
  }, [connected, roomId, name, needsName]);

  // ---- chat ----
  const sendChat = () => {
    const text = chatInputRef.current?.value?.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { name, text, ts: Date.now() / 1000 }]); // optimistic
    socket.emit("chat:send", { roomId, text });
    chatInputRef.current.value = "";
  };

  // ---- rename (server is source of truth) ----
  const rename = () => {
    const next = window.prompt("Choose a new display name:", name || "");
    if (!next) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === name) return;
    socket.emit("name:update", { name: trimmed });
  };

  // ---- run code (multi-language) ----
  const runCode = async () => {
    const code = latestCodeRef.current || "";
    let out = "", err = "";
    try {
      if (language === "python") {
        const res = await runPythonLocal(code);
        out = res.out; err = res.err;
      } else {
        const r = await fetch("http://localhost:5050/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language, code }),
        });
        const j = await r.json();
        out = j.out || ""; err = j.err || "";
      }
    } catch (e) {
      err = String(e);
    }
    const full = [
      err ? `⚠️ Error:\n${err}` : "",
      out ? `Output:\n${out}` : ""
    ].filter(Boolean).join("\n\n");
    setRunOutput(full || "—");
  };

  // chat vertical resize
  const [chatHeight, setChatHeight] = useState(260);
  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  useEffect(() => {
    const onMove = (e) => {
      if (!dragging) return;
      const dy = e.clientY - dragStartY.current;
      const next = Math.max(120, Math.min(600, dragStartHeight.current + dy));
      setChatHeight(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "grid",
        gridTemplateColumns: "1fr 360px",
        gridTemplateRows: "auto 1fr auto",
        gridTemplateAreas: `
          "topbar  topbar"
          "editor  sidebar"
          "console sidebar"
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
          borderBottom: "1px solid var(--line)",
          background: "var(--panel)",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <strong>Multi-User Code Interview Platform</strong>
          <span style={{ color: "var(--muted)" }}>
            Room: <code>{roomId}</code>
          </span>
          <span style={{ color: "var(--muted)" }}>
            {connected ? "🟢 connected" : "⚪️ offline"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={language}
            onChange={(e) => {
              const next = e.target.value;
              setLanguage(next); // instant feedback
              socket.emit("lang:update", { roomId, language: next }); // room-wide
            }}
          >
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
            <option value="cpp">C++</option>
            <option value="java">Java</option>
          </select>
          <button onClick={() => navigator.clipboard?.writeText(window.location.href)}>
            Copy Invite Link
          </button>
          <button onClick={rename}>Rename</button>
        </div>
      </div>

      {/* Editor */}
      <div style={{ gridArea: "editor", minWidth: 0, minHeight: 0, borderRight: "1px solid var(--line)" }}>
        <Editor
          roomId={roomId}
          socket={socket}
          language={language}
          onChange={handleEditorChange}
        />
      </div>

      {/* Sidebar: presence + chat */}
      <div
        style={{
          gridArea: "sidebar",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: "var(--panel)",
          borderLeft: "1px solid var(--line)",
        }}
      >
        <div style={{ padding: 12, borderBottom: "1px solid var(--line)" }}>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>
            You: <code>{name || "—"}</code>
          </div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>In room:</div>
          <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 140, overflowY: "auto" }}>
            {members.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>

        {/* Drag handle for chat height */}
        <div
          onMouseDown={(e) => {
            setDragging(true);
            dragStartY.current = e.clientY;
            dragStartHeight.current = chatHeight;
          }}
          style={{
            height: 6,
            cursor: "row-resize",
            background: "linear-gradient(90deg, transparent, var(--line), transparent)",
          }}
          title="Drag to resize chat"
        />

        {/* Chat */}
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>Chat</div>
          <div
            style={{
              height: chatHeight,
              overflowY: "auto",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: 8,
              background: "#0b0d12",
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
              onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
            />
            <button onClick={sendChat}>Send</button>
          </div>
        </div>
      </div>

      {/* Console / Run Result */}
      <div style={{ gridArea: "console", borderTop: "1px solid var(--line)", background: "var(--panel)", padding: 10, display: "flex", gap: 8, alignItems: "flex-start" }}>
        <button onClick={runCode}>▶︎ Run ({language})</button>
        <div style={{ color: "var(--muted)", paddingTop: 6 }}>Output:</div>
        <textarea
          value={runOutput}
          readOnly
          style={{
            flex: 1,
            minHeight: 60, maxHeight: 240, height: 100,
            resize: "vertical",
            border: "1px solid var(--line)", borderRadius: 8,
            background: "#0b0d12", color: "var(--text)",
            padding: 8,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            whiteSpace: "pre-wrap"
          }}
          placeholder="Program output will appear here…"
        />
      </div>

      {/* Name modal — always on new tab */}
      {needsName && (
        <NameModal
          initial={getStoredName()}
          onSubmit={(val) => {
            if (!val) return;   // keep modal if empty/cancel
            localStorage.setItem("mu_name", val);
            setName(val);
            setNeedsName(false); // join happens in effect
          }}
        />
      )}
    </div>
  );
}
