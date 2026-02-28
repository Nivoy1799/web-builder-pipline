"use client";

import { useState, useEffect } from "react";
import { CAT_LABELS, CAT_ICONS } from "@/lib/constants";
import { Badge } from "./Badge";

function MiniBar({ score }: { score: number }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(score), 100);
    return () => clearTimeout(t);
  }, [score]);
  const col = score >= 80 ? "#22c55e" : score >= 60 ? "#eab308" : score >= 40 ? "#f97316" : "#ef4444";
  return (
    <div style={{ height: 3, background: "rgba(255,255,255,0.04)", borderRadius: 2, flex: 1 }}>
      <div style={{ height: "100%", width: `${w}%`, background: col, borderRadius: 2, transition: "width 0.8s ease" }} />
    </div>
  );
}

export function CategoryRow({ id, data }: {
  id: string;
  data: { score: number; severity: string; finding: string; recommendation: string };
}) {
  const [open, setOpen] = useState(false);
  const col = data.score >= 80 ? "#22c55e" : data.score >= 60 ? "#eab308" : data.score >= 40 ? "#f97316" : "#ef4444";
  return (
    <div onClick={() => setOpen(!open)} style={{ cursor: "pointer", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, width: 22, textAlign: "center", opacity: 0.4 }}>{CAT_ICONS[id] || "·"}</span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", flex: 1 }}>{CAT_LABELS[id as keyof typeof CAT_LABELS] || id}</span>
        <Badge severity={data.severity} />
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, color: col, width: 26, textAlign: "right" }}>{data.score}</span>
        <MiniBar score={data.score} />
      </div>
      {open && (
        <div style={{ paddingLeft: 30, paddingTop: 6, paddingBottom: 4 }}>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", margin: "0 0 4px", lineHeight: 1.5 }}>{data.finding}</p>
          <p style={{ fontSize: 10, color: "rgba(59,130,246,0.7)", margin: 0, lineHeight: 1.5 }}>↳ {data.recommendation}</p>
        </div>
      )}
    </div>
  );
}
