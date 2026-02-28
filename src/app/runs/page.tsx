import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import Link from "next/link";

function scoreColor(s: number) {
  if (s >= 80) return "#22c55e";
  if (s >= 60) return "#eab308";
  if (s >= 40) return "#f97316";
  return "#ef4444";
}

function statusBadge(status: string) {
  const colors: Record<string, { bg: string; c: string }> = {
    pending: { bg: "rgba(255,255,255,0.06)", c: "rgba(255,255,255,0.3)" },
    running: { bg: "rgba(59,130,246,0.12)", c: "#3b82f6" },
    completed: { bg: "rgba(34,197,94,0.12)", c: "#22c55e" },
    failed: { bg: "rgba(239,68,68,0.12)", c: "#ef4444" },
  };
  const s = colors[status] || colors.pending;
  return (
    <span style={{
      fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1,
      padding: "2px 6px", borderRadius: 3, background: s.bg, color: s.c,
    }}>
      {status}
    </span>
  );
}

function relativeTime(date: Date) {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const allRuns = await db
    .select()
    .from(runs)
    .orderBy(desc(runs.createdAt));

  // Group by URL
  const grouped: Record<string, typeof allRuns> = {};
  for (const run of allRuns) {
    if (!grouped[run.url]) grouped[run.url] = [];
    grouped[run.url].push(run);
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px 60px" }}>
      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24, animation: "fadeIn 0.3s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 7, border: "1px solid rgba(255,255,255,0.07)",
            background: "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(139,92,246,0.12))",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 700, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.45)", letterSpacing: 1,
          }}>6×AI</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: -0.3 }}>All Runs</h1>
            <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,0.2)", letterSpacing: 2, textTransform: "uppercase", fontFamily: "var(--mono)" }}>
              Pipeline history
            </p>
          </div>
        </div>
        <Link
          href="/"
          style={{
            padding: "6px 14px", borderRadius: 7, border: "none",
            background: "#3b82f6", color: "white", fontSize: 12, fontWeight: 600,
            textDecoration: "none", transition: "all 0.2s",
          }}
        >
          New Run
        </Link>
      </div>

      {allRuns.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", fontFamily: "var(--mono)" }}>No pipeline runs yet</p>
          <Link href="/" style={{ fontSize: 12, color: "#3b82f6", textDecoration: "none" }}>Run your first pipeline →</Link>
        </div>
      )}

      {Object.entries(grouped).map(([url, urlRuns]) => (
        <div key={url} style={{ marginBottom: 16 }}>
          <div style={{ padding: "4px 0 8px", fontSize: 10, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.25)", borderBottom: "1px solid rgba(255,255,255,0.04)", marginBottom: 4 }}>
            {url.replace(/^https?:\/\//, "")}
          </div>

          {urlRuns.map((run) => (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 12px", borderRadius: 8, textDecoration: "none",
                background: "rgba(255,255,255,0.012)",
                border: "1px solid rgba(255,255,255,0.04)",
                marginBottom: 4, transition: "background 0.15s",
              }}
            >
              {/* Score */}
              {run.scoreOverall != null ? (
                <span style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--mono)", color: scoreColor(run.scoreOverall), width: 40, textAlign: "center" }}>
                  {run.scoreOverall}
                </span>
              ) : (
                <span style={{ width: 40, textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.1)" }}>—</span>
              )}

              {/* Status */}
              {statusBadge(run.status)}

              {/* Current step */}
              {run.currentStep && run.status === "running" && (
                <span style={{ fontSize: 9, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.2)" }}>
                  {run.currentStep}
                </span>
              )}

              {/* Error preview */}
              {run.error && (
                <span style={{ fontSize: 9, color: "rgba(239,68,68,0.6)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {run.error}
                </span>
              )}

              <span style={{ marginLeft: "auto", fontSize: 9, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.12)" }}>
                {relativeTime(run.createdAt)}
              </span>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}
