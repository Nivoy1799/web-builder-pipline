"use client";

import { ScoreRing } from "./ScoreRing";

export function SubAgentCard({ label, icon, color, status, score, progress }: {
  label: string;
  icon: string;
  color: string;
  status: string;
  score?: number | null;
  progress?: { chars: number; outputTokens: number } | null;
}) {
  return (
    <div style={{
      flex: 1, padding: "10px 12px", borderRadius: 8,
      background: status === "done" ? `${color}08` : "rgba(255,255,255,0.015)",
      border: `1px solid ${status === "running" ? color + "40" : status === "done" ? color + "25" : "rgba(255,255,255,0.05)"}`,
      transition: "all 0.4s", position: "relative", overflow: "hidden",
    }}>
      {status === "running" && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${color}, transparent)`, animation: "shimmer 1.5s infinite" }} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: status !== "pending" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.3)" }}>{label}</span>
        {score != null && <ScoreRing score={score} size={28} />}
      </div>
      <span style={{
        fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1,
        color: status === "done" ? "#22c55e" : status === "running" ? color : status === "error" ? "#ef4444" : "rgba(255,255,255,0.15)",
      }}>
        {status === "running" ? (
          progress ? `${progress.chars.toLocaleString()} chars` : "analyzing..."
        ) : status}
      </span>
    </div>
  );
}
