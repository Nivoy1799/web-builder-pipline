import { eq } from "drizzle-orm";
import * as prompts from "@/prompts/index";
import { callClaude, callClaudeJSON, parseHTML, calculateCostUnits, formatCost, type TokenUsage } from "./claude";
import { splitFiles } from "./splitFiles";
import { db } from "./db";
import { runs, runLogs } from "./db/schema";

type SendEvent = (
  event: string,
  data: Record<string, unknown>
) => void;

async function dbLog(
  runId: string,
  agent: string,
  message: string,
  level = "info",
  sendEvent?: SendEvent
) {
  await db.insert(runLogs).values({ runId, agent, level, message });
  sendEvent?.("log", { agent, message, level });
}

async function updateRun(
  runId: string,
  data: Record<string, unknown>,
  sendEvent?: SendEvent
) {
  await db.update(runs).set(data).where(eq(runs.id, runId));
  sendEvent?.("status", data);
}

export async function runPipeline(
  runId: string,
  sendEvent: SendEvent
) {
  const [run] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, runId));
  if (!run) throw new Error("Run not found");

  const targetUrl = run.url;

  const tokenTotals: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  const trackTokens = async (agent: string, usage: TokenUsage) => {
    tokenTotals.inputTokens += usage.inputTokens;
    tokenTotals.outputTokens += usage.outputTokens;
    tokenTotals.totalTokens += usage.totalTokens;
    const costUnits = calculateCostUnits(tokenTotals);
    sendEvent("tokens", {
      agent,
      call: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens },
      cumulative: { ...tokenTotals },
      estimatedCostUsd: costUnits,
      costDisplay: formatCost(costUnits),
    });
    await db.update(runs).set({
      totalInputTokens: tokenTotals.inputTokens,
      totalOutputTokens: tokenTotals.outputTokens,
      totalTokens: tokenTotals.totalTokens,
      estimatedCostUsd: costUnits,
    }).where(eq(runs.id, runId));
  };

  await updateRun(runId, { status: "running", currentStep: "security" }, sendEvent);
  await dbLog(runId, "ORCH", `Pipeline initiated for ${targetUrl}`, "info", sendEvent);
  await dbLog(runId, "ORCH", "Phase 1: Running 3 evaluation sub-agents sequentially", "info", sendEvent);

  // ── PHASE 1: SEQUENTIAL EVALUATION ───────────────────────────────────────

  const runAgent = async (
    key: string,
    label: string,
    logKey: string,
    prompt: string,
    userMsg: string,
    useSearch = true
  ): Promise<Record<string, unknown> | null> => {
    await updateRun(runId, { currentStep: key }, sendEvent);
    sendEvent("step", { step: key, status: "running" });
    await dbLog(runId, logKey, `${label}: analyzing...`, "info", sendEvent);

    try {
      const { result, repaired, usage } = await callClaudeJSON(prompt, userMsg, useSearch);
      await trackTokens(logKey, usage);
      if (repaired) await dbLog(runId, "ORCH", `${label} response truncated — auto-repaired`, "warn", sendEvent);

      const outputField = `${key}Output` as keyof typeof runs;
      await updateRun(runId, { [outputField]: result }, sendEvent);
      sendEvent("step", { step: key, status: "done" });
      sendEvent("output", { key, data: result });
      await dbLog(runId, logKey, `${label} score: ${(result as Record<string, unknown>).overall_score}/100`, "success", sendEvent);
      return result;
    } catch (err) {
      sendEvent("step", { step: key, status: "error" });
      await dbLog(runId, logKey, `Failed: ${err instanceof Error ? err.message : err}`, "error", sendEvent);
      return null;
    }
  };

  const secData = await runAgent(
    "security", "Security", "SEC", prompts.security,
    `Perform a security audit of: ${targetUrl}\n\nExamine HTTPS, headers, cookies, forms, and third-party scripts. Cite specific evidence.`,
    true
  );

  const codeData = await runAgent(
    "code", "Code", "CODE", prompts.code,
    `Analyze code quality of: ${targetUrl}\n\nExamine HTML structure, meta tags, performance signals, accessibility attributes, responsive patterns. Cite specific elements.`,
    true
  );

  const viewData = await runAgent(
    "view", "Visual", "VIEW", prompts.view,
    `Evaluate the visual design and UX of: ${targetUrl}\n\nAnalyze layout, typography, colors, navigation, CTAs, spacing, and overall polish. Describe specific visual evidence.`,
    true
  );

  const successCount = [secData, codeData, viewData].filter(Boolean).length;
  if (successCount < 2) {
    await updateRun(runId, { status: "failed", error: `Only ${successCount}/3 sub-agents succeeded — need at least 2` }, sendEvent);
    sendEvent("error", { message: `Only ${successCount}/3 sub-agents succeeded` });
    return;
  }

  // ── MERGE ────────────────────────────────────────────────────────────────

  await updateRun(runId, { currentStep: "merge" }, sendEvent);
  sendEvent("step", { step: "merge", status: "running" });
  await dbLog(runId, "ORCH", `Merging ${successCount} evaluation reports...`, "info", sendEvent);

  const scores = [
    (secData as Record<string, unknown>)?.overall_score as number | undefined,
    (codeData as Record<string, unknown>)?.overall_score as number | undefined,
    (viewData as Record<string, unknown>)?.overall_score as number | undefined,
  ].filter((s): s is number => s != null);
  const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  const mergedEval = {
    overall_score: overallScore,
    security: secData,
    code: codeData,
    view: viewData,
    tech_stack: (codeData as Record<string, unknown>)?.tech_stack || [],
    meta_info: (codeData as Record<string, unknown>)?.meta_info || {},
    scores: {
      security: ((secData as Record<string, unknown>)?.overall_score as number) || 0,
      code: ((codeData as Record<string, unknown>)?.overall_score as number) || 0,
      view: ((viewData as Record<string, unknown>)?.overall_score as number) || 0,
    },
  };

  await updateRun(runId, { mergedOutput: mergedEval, scoreOverall: overallScore }, sendEvent);
  sendEvent("step", { step: "merge", status: "done" });
  sendEvent("output", { key: "merged", data: mergedEval });
  await dbLog(runId, "ORCH", `Merged: ${overallScore}/100 (Sec: ${mergedEval.scores.security}, Code: ${mergedEval.scores.code}, View: ${mergedEval.scores.view})`, "success", sendEvent);

  // ── PHASE 2: CRAWLER ─────────────────────────────────────────────────────

  await dbLog(runId, "ORCH", "Phase 2: Starting Crawler", "info", sendEvent);
  await updateRun(runId, { currentStep: "crawler" }, sendEvent);
  sendEvent("step", { step: "crawler", status: "running" });
  await dbLog(runId, "CRAWL", `Researching company behind ${targetUrl}...`, "info", sendEvent);

  const { result: crawlResult, repaired: crawlRepaired, usage: crawlUsage } = await callClaudeJSON(
    prompts.crawler,
    `Research the company behind: ${targetUrl}\n\nSite title: "${(mergedEval.meta_info as Record<string, unknown>)?.title || "unknown"}"\nTech: ${(mergedEval.tech_stack as string[])?.join(", ") || "unknown"}\nScores — Sec: ${mergedEval.scores.security}, Code: ${mergedEval.scores.code}, Visual: ${mergedEval.scores.view}\n\nSearch broadly: website, social media, reviews, news.`,
    true
  );
  await trackTokens("CRAWL", crawlUsage);
  if (crawlRepaired) await dbLog(runId, "ORCH", "Crawler response truncated — auto-repaired", "warn", sendEvent);
  if (!crawlResult.company_name) {
    await updateRun(runId, { status: "failed", error: "Crawler could not identify the company" }, sendEvent);
    sendEvent("error", { message: "Crawler could not identify the company" });
    return;
  }

  await updateRun(runId, { crawlerOutput: crawlResult }, sendEvent);
  sendEvent("step", { step: "crawler", status: "done" });
  sendEvent("output", { key: "crawler", data: crawlResult });
  await dbLog(runId, "CRAWL", `Found: ${crawlResult.company_name} — ${crawlResult.industry}`, "success", sendEvent);

  // ── PHASE 3: PLANNER ─────────────────────────────────────────────────────

  await dbLog(runId, "ORCH", "Phase 3: Starting Planner", "info", sendEvent);
  await updateRun(runId, { currentStep: "planner" }, sendEvent);
  sendEvent("step", { step: "planner", status: "running" });
  await dbLog(runId, "PLAN", "Designing improvement strategy...", "info", sendEvent);

  const { result: planResult, repaired: planRepaired, usage: planUsage } = await callClaudeJSON(
    prompts.planner,
    `Create a CONCISE website improvement plan. Keep all values SHORT.

SCORES: Security ${mergedEval.scores.security}/100, Code ${mergedEval.scores.code}/100, Visual ${mergedEval.scores.view}/100 (Overall: ${overallScore})
SECURITY ISSUES: ${(secData as Record<string, unknown>)?.top_3_vulnerabilities ? ((secData as Record<string, unknown>).top_3_vulnerabilities as string[]).join("; ") : "N/A"}
CODE ISSUES: ${(codeData as Record<string, unknown>)?.top_3_issues ? ((codeData as Record<string, unknown>).top_3_issues as string[]).join("; ") : "N/A"}
DESIGN ISSUES: ${(viewData as Record<string, unknown>)?.top_3_design_issues ? ((viewData as Record<string, unknown>).top_3_design_issues as string[]).join("; ") : "N/A"}
DESIGN STRENGTHS: ${(viewData as Record<string, unknown>)?.top_3_design_strengths ? ((viewData as Record<string, unknown>).top_3_design_strengths as string[]).join("; ") : "N/A"}
TECH: ${(mergedEval.tech_stack as string[])?.join(", ")}

COMPANY: ${crawlResult.company_name} | ${crawlResult.industry}
Audience: ${crawlResult.target_audience}
Products: ${(crawlResult.products_services as string[])?.slice(0, 5)?.join(", ")}
Brand: ${crawlResult.brand_voice}

Target scores: Sec ${Math.min(95, mergedEval.scores.security + 20)}+, Code ${Math.min(95, mergedEval.scores.code + 20)}+, Visual ${Math.min(95, mergedEval.scores.view + 20)}+
Max 4 sitemap pages.`,
    false
  );
  await trackTokens("PLAN", planUsage);
  if (planRepaired) await dbLog(runId, "ORCH", "Planner response truncated — auto-repaired", "warn", sendEvent);
  if (!planResult.design_system || !(planResult.sitemap as unknown[])?.length) {
    await updateRun(runId, { status: "failed", error: "Planner missing required fields" }, sendEvent);
    sendEvent("error", { message: "Planner missing required fields" });
    return;
  }

  await updateRun(runId, { plannerOutput: planResult }, sendEvent);
  sendEvent("step", { step: "planner", status: "done" });
  sendEvent("output", { key: "planner", data: planResult });
  await dbLog(runId, "PLAN", `"${planResult.project_name}" — ${(planResult.sitemap as unknown[]).length} pages`, "success", sendEvent);

  // ── PHASE 4: GENERATOR ───────────────────────────────────────────────────

  await dbLog(runId, "ORCH", "Phase 4: Starting Generator", "info", sendEvent);
  await updateRun(runId, { currentStep: "generator" }, sendEvent);
  sendEvent("step", { step: "generator", status: "running" });
  await dbLog(runId, "GEN", "Building the new website...", "info", sendEvent);

  const ds = planResult.design_system as Record<string, unknown>;
  const cs = planResult.content_strategy as Record<string, unknown>;
  const cp = ds?.color_palette as Record<string, unknown> | undefined;
  const tp = ds?.typography as Record<string, unknown> | undefined;
  const images = crawlResult.images as Record<string, unknown> | undefined;

  const { text: genRaw, usage: genUsage } = await callClaude(
    prompts.generator,
    `Build a complete website:

PROJECT: ${planResult.project_name}
STRATEGY: ${planResult.strategy_summary}
DESIGN TOKENS:
  --color-primary: ${cp?.primary}
  --color-secondary: ${cp?.secondary}
  --color-accent: ${cp?.accent}
  --color-bg: ${cp?.background}
  --color-text: ${cp?.text}
  --color-surface: ${cp?.surface || "rgba(255,255,255,0.05)"}
  --color-muted: ${cp?.muted || "rgba(0,0,0,0.5)"}
  --gradient: ${cp?.gradient || `linear-gradient(135deg, ${cp?.primary}, ${cp?.accent})`}
  --font-heading: "${tp?.heading_font}"
  --font-body: "${tp?.body_font}"
  --heading-weight: ${tp?.heading_weight || "700"}
  --radius: ${ds?.border_radius}
  --shadow: ${ds?.shadow || "0 1px 3px rgba(0,0,0,0.1)"}
  --transition: ${ds?.transition || "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"}

CONTENT:
  Hero: "${cs?.hero_headline}" / "${cs?.hero_subheadline}"
  CTAs: "${cs?.cta_primary}" / "${cs?.cta_secondary}"
  Tone: ${cs?.tone}
  Social proof: ${cs?.social_proof || "N/A"}
  Key messages: ${(cs?.key_messages as string[])?.join(" | ")}

SITEMAP: ${(planResult.sitemap as Array<Record<string, unknown>>)?.map((p) => `${p.page}: [${(p.sections as string[])?.join(", ")}] CTA: ${p.cta}`).join(" | ")}
SECURITY FIXES: ${(planResult.security_fixes as string[])?.join(", ")}
COMPANY: ${crawlResult.company_name} | ${crawlResult.industry} | ${(crawlResult.products_services as string[])?.join(", ")}
BRAND VOICE: ${crawlResult.brand_voice || "professional"}
VALUE PROP: ${crawlResult.value_proposition || "N/A"}

IMAGES (use these exact URLs in <img> tags):
  Logo: ${images?.logo || "none — use text logo"}
  Hero: ${images?.hero || "none — use gradient/shapes"}
  Products: ${(images?.products as string[])?.filter(Boolean)?.join(", ") || "none"}
  Team: ${images?.team || "none"}
  Social cover: ${images?.social_cover || "none"}
  Additional: ${(images?.additional as string[])?.filter(Boolean)?.join(", ") || "none"}

Build an AWARD-WINNING, complete, production-ready HTML document. This should look like a $30k agency build. Use the REAL images above — do not invent image URLs.`,
    false,
    32000
  );

  await trackTokens("GEN", genUsage);

  const html = parseHTML(genRaw);
  if (html.length < 500) {
    await updateRun(runId, { status: "failed", error: "Generated HTML too short" }, sendEvent);
    sendEvent("error", { message: "Generated HTML too short" });
    return;
  }

  await updateRun(runId, { generatedHtml: html }, sendEvent);
  sendEvent("step", { step: "generator", status: "done" });
  sendEvent("output", { key: "generator", data: { length: html.length } });
  await dbLog(runId, "GEN", `Generated ${html.length.toLocaleString()} chars of HTML`, "success", sendEvent);

  // ── PHASE 5: SPLIT FILES + FINALIZE ──────────────────────────────────────

  const { files } = splitFiles(html);
  const fileCount = Object.keys(files).length;
  await dbLog(runId, "ORCH", `Split into ${fileCount} files: ${Object.keys(files).join(", ")}`, "info", sendEvent);

  await updateRun(
    runId,
    { files, status: "completed", currentStep: null },
    sendEvent
  );

  await dbLog(runId, "ORCH", "Pipeline complete!", "success", sendEvent);
  const finalCostUnits = calculateCostUnits(tokenTotals);
  sendEvent("complete", {
    scoreOverall: overallScore,
    files: Object.keys(files),
    tokens: { ...tokenTotals },
    estimatedCostUsd: finalCostUnits,
    costDisplay: formatCost(finalCostUnits),
  });
}
