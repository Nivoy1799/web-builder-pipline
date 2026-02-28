"use client";

import { useState, useEffect } from "react";

export function ScoreRing({ score, size = 64 }: { score?: number | null; size?: number }) {
  const sw = 5;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const [d, setD] = useState(0);
  const [o, setO] = useState(circ);

  useEffect(() => {
    if (score == null) return;
    setTimeout(() => setO(circ - (score / 100) * circ), 80);
    let c = 0;
    const iv = setInterval(() => {
      c++;
      if (c > score) return clearInterval(iv);
      setD(c);
    }, 12);
    return () => clearInterval(iv);
  }, [score, circ]);

  const col =
    score == null
      ? "rgba(255,255,255,0.1)"
      : score >= 80
        ? "#22c55e"
        : score >= 60
          ? "#eab308"
          : score >= 40
            ? "#f97316"
            : "#ef4444";

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={sw}
          strokeDasharray={circ} strokeDashoffset={o} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size * 0.28, fontWeight: 700, color: col, fontFamily: "var(--mono)" }}>{d}</span>
      </div>
    </div>
  );
}
