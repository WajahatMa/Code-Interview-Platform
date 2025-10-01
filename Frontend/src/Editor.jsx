import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";

/**
 * Props:
 *  - value: string (the current code to display)
 *  - onChange: fn(nextCode: string) => void (called when local edits happen)
 *  - language: string (e.g., "python" | "javascript")
 */
export default function Editor({ value, onChange, language = "python" }) {
  const containerRef = useRef(null);
  const editorRef = useRef(null);

  // Create the editor once
  useEffect(() => {
    editorRef.current = monaco.editor.create(containerRef.current, {
      value: value ?? "",
      language,
      automaticLayout: true, // adjusts to container size
      minimap: { enabled: false },
      theme: "vs", // default theme
      fontSize: 14,
    });

    // When user types, notify parent
    const sub = editorRef.current.onDidChangeModelContent(() => {
      const next = editorRef.current.getValue();
      onChange?.(next);
    });

    return () => {
      sub.dispose();
      editorRef.current?.dispose();
    };
  }, []); // mount once

  // When parent value changes (from socket), update editor if different
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const current = ed.getValue();
    if (value !== current) {
      // Avoid cursor jumps by only updating when truly different
      ed.setValue(value ?? "");
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      style={{ height: "70vh", border: "1px solid #ddd", borderRadius: 8 }}
    />
  );
}
