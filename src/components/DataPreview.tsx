"use client";

import { useState } from "react";

export function DataPreview({ label, data, color }: {
  label: string;
  data: unknown;
  color: string;
}) {
  const [open, setOpen] = useState(false);
  if (!data) return null;
  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 6, overflow: "hidden", marginBottom: 6 }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", cursor: "pointer" }}>
        <div style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
        <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{label}</span>
        <span style={{ marginLeft: "auto", fontSize: 9, color: "rgba(255,255,255,0.15)", transform: open ? "rotate(180deg)" : "", transition: "transform 0.2s" }}>▼</span>
      </div>
      {open && (
        <pre style={{
          margin: 0, padding: "6px 10px", fontSize: 9, fontFamily: "var(--mono)",
          color: "rgba(255,255,255,0.35)", lineHeight: 1.5, maxHeight: 250, overflow: "auto",
          borderTop: "1px solid rgba(255,255,255,0.03)", whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {typeof data === "string" ? data.slice(0, 5000) : JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
