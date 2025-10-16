// Editor.jsx
import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";

/**
 * Props:
 * - roomId: string
 * - socket: connected socket.io client (shared singleton)
 * - language: "python" | "javascript" | "cpp" | "java"
 * - onChange: (code: string) => void
 */
export default function Editor({ roomId, socket, language = "python", onChange }) {
  const editorElRef = useRef(null);
  const editorRef = useRef(null);
  const inboundRef = useRef("");     // last code received from server to avoid echo
  const throttleRef = useRef(null);  // debounce timer for emitting updates

  // Create the editor ONCE per room (do not depend on language or onChange)
  useEffect(() => {
    const el = editorElRef.current;
    if (!el) return;

    const editor = monaco.editor.create(el, {
      value: "# Start coding together!\n# This text will NOT reset on Run or language change.\n",
      language,                   // only used for the initial create
      automaticLayout: true,
      fontSize: 14,
      minimap: { enabled: false },
      theme: "vs-dark",
    });
    editorRef.current = editor;

    // Report initial value so "Run" works before typing
    try {
      if (typeof onChange === "function") onChange(editor.getValue());
    } catch {}

    // Local edits -> emit to room (throttled)
    const onLocalChange = () => {
      const code = editor.getValue();
      if (typeof onChange === "function") onChange(code);

      // avoid re-broadcasting code we just applied from the server
      if (code === inboundRef.current) return;

      clearTimeout(throttleRef.current);
      throttleRef.current = setTimeout(() => {
        if (socket && socket.connected) {
          socket.emit("code:update", { roomId, code });
        }
      }, 120);
    };
    const disposable = editor.onDidChangeModelContent(onLocalChange);

    // Server -> apply incoming code (no echo)
    const onApply = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      const current = editor.getValue();
      if (payload.code !== current) {
        inboundRef.current = payload.code;
        editor.setValue(payload.code);
        if (typeof onChange === "function") onChange(payload.code);
      }
    };

    if (socket) socket.on("code:apply", onApply);

    return () => {
      disposable?.dispose();
      if (socket) socket.off("code:apply", onApply);
      clearTimeout(throttleRef.current);
      try { editor.dispose(); } catch {}
      editorRef.current = null;
    };
  }, [roomId, socket]); // IMPORTANT: do NOT add `language` or `onChange` here

  // Change syntax highlighting WITHOUT recreating the editor
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel?.();
    if (!model) return;
    monaco.editor.setModelLanguage(model, language);
  }, [language]);

  return <div ref={editorElRef} style={{ width: "100%", height: "100%" }} />;
}
