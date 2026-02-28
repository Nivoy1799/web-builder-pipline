"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewRunForm() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async () => {
    if (!url.trim() || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const { id } = await res.json();
      router.push(`/runs/${id}`);
    } catch {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: "flex", gap: 8, padding: 4,
      background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)",
      animation: "fadeIn 0.3s ease 0.05s both",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, padding: "0 10px" }}>
        <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.12)" }}>URL</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
          placeholder="example.com"
          disabled={loading}
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            color: "white", fontSize: 13, fontFamily: "var(--mono)", padding: "10px 0",
          }}
        />
      </div>
      <button
        onClick={handleSubmit}
        disabled={!url.trim() || loading}
        style={{
          padding: "10px 22px", borderRadius: 7, border: "none",
          background: url.trim() ? "#3b82f6" : "rgba(255,255,255,0.03)",
          color: url.trim() ? "white" : "rgba(255,255,255,0.12)",
          fontSize: 12, fontWeight: 600,
          cursor: url.trim() && !loading ? "pointer" : "not-allowed",
          transition: "all 0.2s",
        }}
      >
        {loading ? "Starting..." : "Run Pipeline"}
      </button>
    </div>
  );
}
