// Editor.jsx
import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import { io } from "socket.io-client";

// Reuse the same socket as App.jsx by importing `io` here is fine if you
// keep a second instance from connecting. The simplest is: emit/listen
// via window.socket set in App. But to keep this drop-in, we'll just
// listen for code:apply sent by the server and emit code:update via the
// same server URL. If you prefer a single shared socket instance,
// pass `socket` down from App as a prop and remove the local one here.

const socket = io("http://localhost:5050", {
  transports: ["websocket"],
  withCredentials: true,
  autoConnect: true,
});

export default function Editor({ roomId, language = "javascript" }) {
  const editorElRef = useRef(null);
  const editorRef = useRef(null);
  const inboundRef = useRef("");
  const throttleRef = useRef(null);

  useEffect(() => {
    const el = editorElRef.current;
    if (!el) return;

    const editor = monaco.editor.create(el, {
      value: "// Start coding...\n",
      language,
      automaticLayout: true,
      fontSize: 14,
      minimap: { enabled: false },
    });
    editorRef.current = editor;

    // join room on connect (in case this socket is separate)
    const onConnect = () => {
      socket.emit("join", { roomId, name: localStorage.getItem("mu_name") || "" });
    };

    // local -> server (throttled)
    const onChange = () => {
      const code = editor.getValue();
      if (code === inboundRef.current) return;
      clearTimeout(throttleRef.current);
      throttleRef.current = setTimeout(() => {
        socket.emit("code:update", { roomId, code });
      }, 120);
    };
    const disposable = editor.onDidChangeModelContent(onChange);

    // server -> local
    const onApply = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      const current = editor.getValue();
      if (payload.code !== current) {
        inboundRef.current = payload.code;
        editor.setValue(payload.code);
      }
    };

    socket.on("connect", onConnect);
    socket.on("code:apply", onApply);

    return () => {
      disposable?.dispose();
      socket.off("connect", onConnect);
      socket.off("code:apply", onApply);
      clearTimeout(throttleRef.current);
      try { editor.dispose(); } catch {}
    };
  }, [roomId, language]);

  return <div ref={editorElRef} style={{ width: "100%", height: "100%" }} />;
}
