"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { INITIAL_STATUSES } from "@/lib/constants";
import type { StepStatus, PipelineStep } from "@/lib/constants";
import { reassembleHTML } from "@/lib/splitFiles";
import { createZip } from "@/lib/zip";
import { normalizeUrl } from "@/lib/utils";
import { ScoreRing } from "./ScoreRing";
import { LogEntry } from "./LogEntry";
import { CategoryRow } from "./CategoryRow";
import { DataPreview } from "./DataPreview";
import { SubAgentCard } from "./SubAgentCard";
import { PipelineStep as PipelineStepUI, Arrow } from "./PipelineStep";

type LogItem = { time: string; agent: string; message: string; type: string };

interface PipelineViewProps {
  runId: string;
  initialRun: {
    id: string;
    url: string;
    status: string;
    securityOutput?: unknown;
    codeOutput?: unknown;
    viewOutput?: unknown;
    mergedOutput?: unknown;
    crawlerOutput?: unknown;
    plannerOutput?: unknown;
    generatedHtml?: string | null;
    files?: Record<string, string> | null;
    scoreOverall?: number | null;
    error?: string | null;
    logs?: Array<{ agent: string; level: string; message: string; createdAt: string }>;
  };
}

export function PipelineView({ runId, initialRun }: PipelineViewProps) {
  const router = useRouter();
  const isAlreadyDone = initialRun.status === "completed" || initialRun.status === "failed";

  // Build initial state from DB data
  const buildInitialStatuses = (): Record<PipelineStep, StepStatus> => {
    if (initialRun.status === "completed") {
      return Object.fromEntries(
        Object.keys(INITIAL_STATUSES).map((k) => [k, "done"])
      ) as Record<PipelineStep, StepStatus>;
    }
    if (initialRun.status === "failed") {
      const s = { ...INITIAL_STATUSES };
      // Mark steps with data as done
      if (initialRun.securityOutput) s.security = "done";
      if (initialRun.codeOutput) s.code = "done";
      if (initialRun.viewOutput) s.view = "done";
      if (initialRun.mergedOutput) s.merge = "done";
      if (initialRun.crawlerOutput) s.crawler = "done";
      if (initialRun.plannerOutput) s.planner = "done";
      if (initialRun.generatedHtml) s.generator = "done";
      return s;
    }
    return { ...INITIAL_STATUSES };
  };

  const buildInitialOutputs = (): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    if (initialRun.securityOutput) o.security = initialRun.securityOutput;
    if (initialRun.codeOutput) o.code = initialRun.codeOutput;
    if (initialRun.viewOutput) o.view = initialRun.viewOutput;
    if (initialRun.mergedOutput) o.merged = initialRun.mergedOutput;
    if (initialRun.crawlerOutput) o.crawler = initialRun.crawlerOutput;
    if (initialRun.plannerOutput) o.planner = initialRun.plannerOutput;
    if (initialRun.generatedHtml) o.generator = initialRun.generatedHtml;
    return o;
  };

  const buildInitialLogs = (): LogItem[] => {
    return (initialRun.logs || []).map((l) => ({
      time: new Date(l.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      agent: l.agent,
      message: l.message,
      type: l.level,
    }));
  };

  const [statuses, setStatuses] = useState(buildInitialStatuses);
  const [outputs, setOutputs] = useState(buildInitialOutputs);
  const [logs, setLogs] = useState<LogItem[]>(buildInitialLogs);
  const [running, setRunning] = useState(!isAlreadyDone);
  const [done, setDone] = useState(initialRun.status === "completed");
  const [error, setError] = useState<string | null>(initialRun.error || null);
  const [showPreview, setShowPreview] = useState(isAlreadyDone && !!initialRun.generatedHtml);
  const [origIframeFailed, setOrigIframeFailed] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const origIframeRef = useRef<HTMLIFrameElement>(null);

  const ts = () =>
    new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // SSE connection
  useEffect(() => {
    if (isAlreadyDone) return;

    const es = new EventSource(`/api/runs/${runId}/stream`);

    es.addEventListener("log", (e) => {
      const d = JSON.parse(e.data);
      setLogs((prev) => [...prev, { time: ts(), agent: d.agent, message: d.message, type: d.level }]);
    });

    es.addEventListener("step", (e) => {
      const d = JSON.parse(e.data);
      setStatuses((prev) => ({ ...prev, [d.step]: d.status }));
    });

    es.addEventListener("output", (e) => {
      const d = JSON.parse(e.data);
      setOutputs((prev) => ({ ...prev, [d.key]: d.data }));
    });

    es.addEventListener("status", (e) => {
      const d = JSON.parse(e.data);
      if (d.status === "failed") {
        setError(d.error || "Pipeline failed");
        setRunning(false);
      }
    });

    es.addEventListener("error", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data);
        setError(d.message);
      } catch {
        // SSE connection error
      }
      setRunning(false);
    });

    es.addEventListener("complete", () => {
      setDone(true);
      setRunning(false);
      setShowPreview(true);
      // Refresh run data
      fetch(`/api/runs/${runId}`)
        .then((r) => r.json())
        .then((run) => {
          if (run.files) {
            setOutputs((prev) => ({ ...prev, _files: run.files }));
          }
        });
    });

    es.onerror = () => {
      es.close();
      setRunning(false);
    };

    return () => es.close();
  }, [runId, isAlreadyDone]);

  // Write preview HTML to iframe
  const previewHtml = useCallback(() => {
    const gen = outputs.generator as string | undefined;
    if (!gen) return null;
    // If it's raw HTML string, use directly
    if (typeof gen === "string") return gen;
    return null;
  }, [outputs.generator]);

  const getFiles = useCallback((): Record<string, string> | null => {
    const f = (outputs._files || initialRun.files) as Record<string, string> | null;
    return f;
  }, [outputs._files, initialRun.files]);

  useEffect(() => {
    if (showPreview && iframeRef.current) {
      const files = getFiles();
      const html = files ? reassembleHTML(files) : previewHtml();
      if (html) {
        const doc = iframeRef.current.contentDocument;
        if (doc) {
          doc.open();
          doc.write(html);
          doc.close();
        }
      }
    }
  }, [showPreview, previewHtml, getFiles]);

  const downloadProject = () => {
    const files = getFiles();
    if (!files) return;
    const blob = createZip(files);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const crawler = outputs.crawler as Record<string, unknown> | undefined;
    const name = (crawler?.company_name as string)?.toLowerCase().replace(/\s+/g, "-") || "site";
    a.download = `${name}-redesign.zip`;
    a.click();
  };

  const downloadReport = () => {
    const report = {
      pipeline_run: new Date().toISOString(),
      url: initialRun.url,
      security: outputs.security,
      code: outputs.code,
      view: outputs.view,
      company: outputs.crawler,
      plan: outputs.planner,
      html_length: (outputs.generator as string)?.length,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pipeline-report.json";
    a.click();
  };

  const sec = outputs.security as Record<string, unknown> | undefined;
  const cod = outputs.code as Record<string, unknown> | undefined;
  const viw = outputs.view as Record<string, unknown> | undefined;
  const merged = outputs.merged as Record<string, unknown> | undefined;
  const crawler = outputs.crawler as Record<string, unknown> | undefined;
  const planner = outputs.planner as Record<string, unknown> | undefined;
  const gen = outputs.generator;

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
              {initialRun.url.replace(/^https?:\/\//, "")}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a href="/runs" style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "rgba(255,255,255,0.25)", fontSize: 10, fontWeight: 600, fontFamily: "var(--mono)", cursor: "pointer", textDecoration: "none" }}>
            All Runs
          </a>
          <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.12)" }}>
            {running && <span style={{ animation: "pulse 1.2s infinite", color: "#3b82f6" }}>● RUNNING</span>}
            {done && <span style={{ color: "#22c55e" }}>● COMPLETE</span>}
            {error && !running && <span style={{ color: "#ef4444" }}>● ERROR</span>}
          </div>
        </div>
      </div>

      {/* PIPELINE VISUALIZATION */}
      <div style={{ marginBottom: 16, animation: "fadeIn 0.3s ease 0.1s both" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          <div style={{
            padding: 6, borderRadius: 10, border: `1px solid ${statuses.merge === "done" ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.05)"}`,
            background: "rgba(255,255,255,0.01)", transition: "border-color 0.4s",
          }}>
            <div style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.5, color: "rgba(255,255,255,0.2)", padding: "2px 6px 6px", fontFamily: "var(--mono)" }}>
              Evaluation Agents
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <SubAgentCard label="Security" icon="🛡" color="#ef4444" status={statuses.security} score={(sec?.overall_score as number) ?? null} />
              <SubAgentCard label="Code" icon="⚙" color="#f59e0b" status={statuses.code} score={(cod?.overall_score as number) ?? null} />
              <SubAgentCard label="View" icon="◈" color="#3b82f6" status={statuses.view} score={(viw?.overall_score as number) ?? null} />
            </div>
          </div>
          <Arrow active={statuses.merge === "done"} />
          <PipelineStepUI label="Crawler" icon="⛏" color="#a78bfa" status={statuses.crawler} />
          <Arrow active={statuses.crawler === "done"} />
          <PipelineStepUI label="Planner" icon="✎" color="#8b5cf6" status={statuses.planner} />
          <Arrow active={statuses.planner === "done"} />
          <PipelineStepUI label="Generator" icon="🔨" color="#22c55e" status={statuses.generator} isWide />
        </div>
      </div>

      {/* MAIN CONTENT: LOG + OUTPUTS */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, animation: "fadeIn 0.3s ease 0.15s both" }}>
        {/* LOG */}
        <div style={{ background: "rgba(255,255,255,0.012)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: 520 }}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: running ? "#3b82f6" : done ? "#22c55e" : "rgba(255,255,255,0.08)", animation: running ? "pulse 1s infinite" : "none" }} />
            <span style={{ fontSize: 10, fontWeight: 600, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1.5 }}>Log</span>
            <span style={{ marginLeft: "auto", fontSize: 9, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.1)" }}>{logs.length}</span>
          </div>
          <div ref={logRef} style={{ flex: 1, overflow: "auto", padding: "6px 12px" }}>
            {logs.length === 0 && <p style={{ fontSize: 10, color: "rgba(255,255,255,0.1)", fontFamily: "var(--mono)", textAlign: "center", padding: 32 }}>Waiting for pipeline...</p>}
            {logs.map((l, i) => <LogEntry key={i} {...l} />)}
          </div>
        </div>

        {/* OUTPUTS */}
        <div style={{ background: "rgba(255,255,255,0.012)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: 520 }}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <span style={{ fontSize: 10, fontWeight: 600, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1.5 }}>Outputs</span>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: 10 }}>
            {Object.keys(outputs).filter((k) => k !== "_files").length === 0 && (
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.1)", fontFamily: "var(--mono)", textAlign: "center", padding: 32 }}>Outputs appear here...</p>
            )}

            {merged && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)", marginBottom: 8 }}>
                <ScoreRing score={merged.overall_score as number} size={52} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.7)", marginBottom: 4 }}>Overall: {merged.overall_score as number}/100</div>
                  <div style={{ display: "flex", gap: 8, fontSize: 10 }}>
                    <span style={{ color: "#ef4444" }}>🛡 {(merged.scores as Record<string, number>)?.security}</span>
                    <span style={{ color: "#f59e0b" }}>⚙ {(merged.scores as Record<string, number>)?.code}</span>
                    <span style={{ color: "#3b82f6" }}>◈ {(merged.scores as Record<string, number>)?.view}</span>
                  </div>
                </div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{(merged.tech_stack as string[])?.slice(0, 3)?.join(", ")}</div>
              </div>
            )}

            {sec?.categories != null && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#ef4444", padding: "4px 0", display: "flex", alignItems: "center", gap: 4 }}>
                  <span>🛡</span> Security — {String(sec.overall_score)}/100
                </div>
                {Object.entries(sec.categories as Record<string, { score: number; severity: string; finding: string; recommendation: string }>).map(([k, v]) => (
                  <CategoryRow key={k} id={k} data={v} />
                ))}
                <DataPreview label="Full Security Report" data={sec} color="#ef4444" />
              </div>
            )}

            {cod?.categories != null && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#f59e0b", padding: "4px 0", display: "flex", alignItems: "center", gap: 4 }}>
                  <span>⚙</span> Code Quality — {String(cod.overall_score)}/100
                </div>
                {Object.entries(cod.categories as Record<string, { score: number; severity: string; finding: string; recommendation: string }>).map(([k, v]) => (
                  <CategoryRow key={k} id={k} data={v} />
                ))}
                <DataPreview label="Full Code Report" data={cod} color="#f59e0b" />
              </div>
            )}

            {viw?.categories != null && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#3b82f6", padding: "4px 0", display: "flex", alignItems: "center", gap: 4 }}>
                  <span>◈</span> Visual / UX — {String(viw.overall_score)}/100
                </div>
                {Object.entries(viw.categories as Record<string, { score: number; severity: string; finding: string; recommendation: string }>).map(([k, v]) => (
                  <CategoryRow key={k} id={k} data={v} />
                ))}
                <DataPreview label="Full Visual Report" data={viw} color="#3b82f6" />
              </div>
            )}

            {crawler != null && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#a78bfa", padding: "4px 0" }}>⛏ {String(crawler.company_name)} — {String(crawler.industry)}</div>
                <DataPreview label="Company Profile" data={crawler} color="#a78bfa" />
              </div>
            )}
            {planner != null && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#8b5cf6", padding: "4px 0" }}>✎ {String(planner.project_name)} — {(planner.sitemap as unknown[])?.length} pages</div>
                <DataPreview label="Site Plan" data={planner} color="#8b5cf6" />
              </div>
            )}
            {gen != null && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#22c55e", padding: "4px 0" }}>
                  🔨 Generated — {typeof gen === "string" ? gen.length.toLocaleString() : String((gen as Record<string, unknown>)?.length)} chars
                </div>
                <DataPreview label="HTML Source" data={typeof gen === "string" ? gen : `${String((gen as Record<string, unknown>)?.length)} chars`} color="#22c55e" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PREVIEW */}
      {(running || done) && (
        <div style={{ marginTop: 12, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.05)", background: "#0d0d14", animation: "fadeIn 0.3s ease" }}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1.5 }}>
              {showPreview ? "Generated Preview" : "Original Site"}
            </span>
            {done && (
              <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                <button onClick={() => setShowPreview(false)} style={{ padding: "3px 8px", borderRadius: 3, border: "none", fontSize: 9, fontWeight: 600, cursor: "pointer", background: !showPreview ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.03)", color: !showPreview ? "#60a5fa" : "rgba(255,255,255,0.2)" }}>Original</button>
                <button onClick={() => setShowPreview(true)} style={{ padding: "3px 8px", borderRadius: 3, border: "none", fontSize: 9, fontWeight: 600, cursor: "pointer", background: showPreview ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.03)", color: showPreview ? "#22c55e" : "rgba(255,255,255,0.2)" }}>Generated</button>
              </div>
            )}
          </div>
          <div style={{ height: 400, position: "relative" }}>
            {!showPreview ? (
              !origIframeFailed ? (
                <iframe
                  ref={origIframeRef}
                  src={normalizeUrl(initialRun.url)}
                  title="Original"
                  style={{ width: "100%", height: "100%", border: "none", background: "white" }}
                  sandbox="allow-scripts allow-same-origin"
                  onError={() => setOrigIframeFailed(true)}
                  onLoad={() => {
                    try {
                      const d = origIframeRef.current?.contentDocument;
                      if (d && !d.body?.innerHTML) setOrigIframeFailed(true);
                    } catch {
                      /* cross-origin */
                    }
                  }}
                />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>Site blocks iframe embedding</p>
                  <a href={normalizeUrl(initialRun.url)} target="_blank" rel="noopener noreferrer"
                    style={{ padding: "6px 14px", borderRadius: 5, fontSize: 11, fontWeight: 600, background: "rgba(59,130,246,0.12)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.2)", textDecoration: "none", fontFamily: "var(--mono)" }}>
                    Open original ↗
                  </a>
                </div>
              )
            ) : (
              <iframe ref={iframeRef} title="Generated" style={{ width: "100%", height: "100%", border: "none", background: "white" }} sandbox="allow-scripts allow-same-origin" />
            )}
          </div>
        </div>
      )}

      {/* ACTIONS */}
      {done && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, animation: "fadeIn 0.3s ease" }}>
          <button onClick={() => router.push("/")} style={{ flex: 1, padding: "11px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>New Run</button>
          <button onClick={downloadReport} style={{ flex: 1, padding: "11px 16px", borderRadius: 8, border: "1px solid rgba(139,92,246,0.25)", background: "rgba(139,92,246,0.08)", color: "#a78bfa", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Report JSON</button>
          <button onClick={downloadProject} style={{ flex: 1, padding: "11px 16px", borderRadius: 8, border: "none", background: "#22c55e", color: "#052e16", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Download Project (.zip)</button>
        </div>
      )}

      {error && !running && (
        <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 8, background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.12)", display: "flex", gap: 10, animation: "fadeIn 0.3s ease" }}>
          <span>⚠</span>
          <div>
            <p style={{ fontSize: 12, color: "#ef4444", margin: 0, fontWeight: 500 }}>{error}</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", margin: "3px 0 0" }}>Check log for details. Retry by running again.</p>
          </div>
        </div>
      )}
    </div>
  );
}
