import { NewRunForm } from "@/components/NewRunForm";
import Link from "next/link";

export default function HomePage() {
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
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: -0.3 }}>Website Pipeline</h1>
            <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,0.2)", letterSpacing: 2, textTransform: "uppercase", fontFamily: "var(--mono)" }}>
              3× Evaluate → Crawl → Plan → Generate
            </p>
          </div>
        </div>
        <Link
          href="/runs"
          style={{
            padding: "4px 10px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.06)",
            background: "transparent", color: "rgba(255,255,255,0.25)", fontSize: 10, fontWeight: 600,
            fontFamily: "var(--mono)", textDecoration: "none", transition: "all 0.2s",
          }}
        >
          All Runs
        </Link>
      </div>

      <NewRunForm />
    </div>
  );
}
