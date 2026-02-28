"use client";

import { AGENT_COLORS } from "@/lib/constants";

export function LogEntry({ time, agent, message, type = "info" }: {
  time: string;
  agent: string;
  message: string;
  type?: string;
}) {
  const colors: Record<string, string> = {
    info: "rgba(255,255,255,0.4)",
    success: "#22c55e",
    error: "#ef4444",
    warn: "#eab308",
  };
  return (
    <div style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: 11, fontFamily: "var(--mono)", lineHeight: 1.5 }}>
      <span style={{ color: "rgba(255,255,255,0.12)", flexShrink: 0 }}>{time}</span>
      <span style={{ color: AGENT_COLORS[agent] || "#60a5fa", flexShrink: 0, fontWeight: 600 }}>[{agent}]</span>
      <span style={{ color: colors[type] || colors.info }}>{message}</span>
    </div>
  );
}
