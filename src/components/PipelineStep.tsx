"use client";

export function PipelineStep({ label, icon, color, status, isWide }: {
  label: string;
  icon: string;
  color: string;
  status: string;
  isWide?: boolean;
}) {
  return (
    <div style={{
      padding: "10px 14px", borderRadius: 8, minWidth: isWide ? 150 : 120,
      background: status === "done" ? "rgba(34,197,94,0.04)" : status === "running" ? `${color}08` : "rgba(255,255,255,0.01)",
      border: `1px solid ${status === "done" ? "rgba(34,197,94,0.2)" : status === "running" ? color + "35" : status === "error" ? "rgba(239,68,68,0.25)" : "rgba(255,255,255,0.05)"}`,
      transition: "all 0.4s", position: "relative", overflow: "hidden",
    }}>
      {status === "running" && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${color}, transparent)`, animation: "shimmer 1.5s infinite" }} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: status !== "pending" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.3)" }}>{label}</span>
      </div>
      <span style={{
        fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1,
        color: status === "done" ? "#22c55e" : status === "running" ? color : status === "error" ? "#ef4444" : "rgba(255,255,255,0.15)",
      }}>
        {status === "running" ? "running..." : status}
      </span>
    </div>
  );
}

export function Arrow({ active }: { active: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "0 2px" }}>
      <div style={{ width: 16, height: 1, background: active ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.06)", transition: "background 0.4s" }} />
      <span style={{ fontSize: 8, color: active ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.08)", transition: "color 0.4s" }}>▸</span>
    </div>
  );
}
