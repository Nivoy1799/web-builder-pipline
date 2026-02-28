"use client";

const STYLES: Record<string, { bg: string; c: string; b: string }> = {
  critical: { bg: "rgba(239,68,68,0.15)", c: "#ef4444", b: "rgba(239,68,68,0.3)" },
  warning: { bg: "rgba(234,179,8,0.15)", c: "#eab308", b: "rgba(234,179,8,0.3)" },
  good: { bg: "rgba(34,197,94,0.12)", c: "#22c55e", b: "rgba(34,197,94,0.25)" },
  excellent: { bg: "rgba(59,130,246,0.12)", c: "#60a5fa", b: "rgba(59,130,246,0.25)" },
};

const DEFAULT = { bg: "rgba(255,255,255,0.06)", c: "rgba(255,255,255,0.4)", b: "rgba(255,255,255,0.08)" };

export function Badge({ severity }: { severity: string }) {
  const s = STYLES[severity] || DEFAULT;
  return (
    <span style={{
      fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.2,
      padding: "2px 6px", borderRadius: 3, background: s.bg, color: s.c, border: `1px solid ${s.b}`,
    }}>
      {severity}
    </span>
  );
}
