import { eq } from "drizzle-orm";
import * as prompts from "@/prompts/index";
import { callClaude, callClaudeJSON, parseHTML, calculateCostUnits, formatCost, MODELS, type TokenUsage, type ModelId, type ProgressCallback } from "./claude";
import { splitFiles } from "./splitFiles";
import { scrapeWebsite, isScrapeSufficient, mergeWithScraped } from "./scraper";
import { fetchUnsplashImages } from "./unsplash";
import { db } from "./db";
import { runs, runLogs } from "./db/schema";

type SendEvent = (
  event: string,
  data: Record<string, unknown>
) => void;

export class PipelineCancelledError extends Error {
  constructor() {
    super("Pipeline cancelled");
    this.name = "PipelineCancelledError";
  }
}

async function checkCancelled(runId: string, sendEvent: SendEvent) {
  const [row] = await db
    .select({ status: runs.status })
    .from(runs)
    .where(eq(runs.id, runId));
  if (row?.status === "cancelled") {
    sendEvent("cancelled", { message: "Pipeline was cancelled" });
    throw new PipelineCancelledError();
  }
}

// Default model per agent — eval agents use Haiku (cheap), reasoning agents use Sonnet
const DEFAULT_AGENT_MODELS: Record<string, ModelId> = {
  security: MODELS.haiku,
  code: MODELS.haiku,
  view: MODELS.haiku,
  crawler: MODELS.sonnet,
  planner: MODELS.sonnet,
  generator: MODELS.sonnet,
  reeval: MODELS.haiku,
};

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

  // Merge per-run config overrides (from DB) over defaults
  const runConfig = (run as Record<string, unknown>).config as Record<string, string> | null;
  const agentModels: Record<string, ModelId> = { ...DEFAULT_AGENT_MODELS };
  if (runConfig?.models) {
    Object.assign(agentModels, runConfig.models);
  }

  const tokenTotals: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let totalCostUnits = 0;

  const trackTokens = async (agent: string, usage: TokenUsage, model: ModelId) => {
    tokenTotals.inputTokens += usage.inputTokens;
    tokenTotals.outputTokens += usage.outputTokens;
    tokenTotals.totalTokens += usage.totalTokens;
    totalCostUnits += calculateCostUnits(usage, model);
    sendEvent("tokens", {
      agent,
      call: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens },
      cumulative: { ...tokenTotals },
      estimatedCostUsd: totalCostUnits,
      costDisplay: formatCost(totalCostUnits),
    });
    await db.update(runs).set({
      totalInputTokens: tokenTotals.inputTokens,
      totalOutputTokens: tokenTotals.outputTokens,
      totalTokens: tokenTotals.totalTokens,
      estimatedCostUsd: totalCostUnits,
    }).where(eq(runs.id, runId));
  };

  try {
  await updateRun(runId, { status: "running", currentStep: "security" }, sendEvent);
  await dbLog(runId, "ORCH", `Pipeline initiated for ${targetUrl}`, "info", sendEvent);
  await dbLog(runId, "ORCH", "Phase 1: Running 3 evaluation sub-agents in parallel", "info", sendEvent);

  // ── PHASE 1: PARALLEL EVALUATION ──────────────────────────────────────

  const runAgent = async (
    key: string,
    label: string,
    logKey: string,
    prompt: string,
    userMsg: string,
    useSearch = true
  ): Promise<Record<string, unknown> | null> => {
    const model = agentModels[key] ?? MODELS.sonnet;
    sendEvent("step", { step: key, status: "running" });
    await dbLog(runId, logKey, `${label}: analyzing (${model})...`, "info", sendEvent);

    try {
      const onProgress: ProgressCallback = ({ chars, outputTokens }) => {
        sendEvent("progress", { step: key, chars, outputTokens });
      };
      const { result, repaired, usage } = await callClaudeJSON(prompt, userMsg, useSearch, 1, model, onProgress);
      await trackTokens(logKey, usage, model);
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

  const [secData, codeData, viewData] = await Promise.all([
    runAgent(
      "security", "Security", "SEC", prompts.security,
      `Perform a security audit of: ${targetUrl}\n\nExamine HTTPS, headers, cookies, forms, and third-party scripts. Cite specific evidence.`,
      true
    ),
    runAgent(
      "code", "Code", "CODE", prompts.code,
      `Analyze code quality of: ${targetUrl}\n\nExamine HTML structure, meta tags, performance signals, accessibility attributes, responsive patterns. Cite specific elements.`,
      true
    ),
    runAgent(
      "view", "Visual", "VIEW", prompts.view,
      `Evaluate the visual design and UX of: ${targetUrl}\n\nAnalyze layout, typography, colors, navigation, CTAs, spacing, and overall polish. Describe specific visual evidence.`,
      true
    ),
  ]);

  // ── CANCELLATION CHECK 1: After parallel eval ──
  await checkCancelled(runId, sendEvent);

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

  // ── CANCELLATION CHECK 2: After merge, before crawler ──
  await checkCancelled(runId, sendEvent);

  // ── PHASE 2: CRAWLER (scrape-first, AI fallback) ─────────────────────────

  const crawlerModel = agentModels.crawler ?? MODELS.sonnet;
  await dbLog(runId, "ORCH", "Phase 2: Starting Crawler", "info", sendEvent);
  await updateRun(runId, { currentStep: "crawler" }, sendEvent);
  sendEvent("step", { step: "crawler", status: "running" });

  // Step 1: Scrape the target URL (free, fast)
  await dbLog(runId, "CRAWL", `Scraping ${targetUrl} for meta/OG/JSON-LD data...`, "info", sendEvent);
  const scraped = await scrapeWebsite(targetUrl);

  const scrapedFields = [
    scraped.company_name && "name",
    scraped.description && "description",
    scraped.industry && "industry",
    scraped.images.logo && "logo",
    scraped.images.hero && "hero",
    scraped.social_media.linkedin && "linkedin",
    scraped.social_media.twitter && "twitter",
  ].filter(Boolean);
  await dbLog(runId, "CRAWL", `Scraped: found ${scrapedFields.length} fields (${scrapedFields.join(", ")})`, "info", sendEvent);
  sendEvent("progress", { step: "crawler", scraped: scrapedFields });

  let crawlResult: Record<string, unknown>;

  // Step 2: Check if scraped data is sufficient
  if (isScrapeSufficient(scraped)) {
    // Sufficient — use scraped data directly, skip AI crawler ($0 cost)
    crawlResult = scraped as unknown as Record<string, unknown>;
    await dbLog(runId, "CRAWL", `Scrape sufficient — skipping AI crawler (saved ~$0.02)`, "success", sendEvent);
  } else {
    // Insufficient — fall back to AI crawler, pass scraped data as context
    await dbLog(runId, "CRAWL", `Scrape insufficient — falling back to AI crawler (${crawlerModel})...`, "info", sendEvent);

    const scrapedContext = scrapedFields.length > 0
      ? `\n\nAlready scraped from the ACTUAL site HTML (these are ground truth — do NOT override with data from other businesses):\n${scraped.company_name ? `Company: ${scraped.company_name}\n` : ""}${scraped.description ? `Description: ${scraped.description}\n` : ""}${scraped.industry ? `Industry: ${scraped.industry}\n` : ""}${scraped.location ? `Location: ${scraped.location}\n` : ""}${scraped.images.logo ? `Logo URL: ${scraped.images.logo}\n` : ""}${scraped.images.hero ? `Hero image URL: ${scraped.images.hero}\n` : ""}${scraped.social_media.linkedin ? `LinkedIn: ${scraped.social_media.linkedin}\n` : ""}${scraped.social_media.twitter ? `Twitter: ${scraped.social_media.twitter}\n` : ""}${scraped.social_media.facebook ? `Facebook: ${scraped.social_media.facebook}\n` : ""}${scraped.social_media.instagram ? `Instagram: ${scraped.social_media.instagram}\n` : ""}${scraped.seo_keywords.length ? `SEO keywords: ${scraped.seo_keywords.join(", ")}\n` : ""}`
      : "";

    const { result, repaired: crawlRepaired, usage: crawlUsage } = await callClaudeJSON(
      prompts.crawler,
      `Research the company at this EXACT URL: ${targetUrl}\n\nIMPORTANT: Only return information about the business at this specific website. If there are multiple businesses with similar names, use ONLY data from ${targetUrl} and its linked social profiles. Do not mix in data from other businesses.\n\nSite title: "${(mergedEval.meta_info as Record<string, unknown>)?.title || "unknown"}"\nTech: ${(mergedEval.tech_stack as string[])?.join(", ") || "unknown"}\nScores — Sec: ${mergedEval.scores.security}, Code: ${mergedEval.scores.code}, Visual: ${mergedEval.scores.view}\n\nSearch broadly: website, social media, reviews, news.${scrapedContext}`,
      true,
      1,
      crawlerModel,
      ({ chars, outputTokens }) => sendEvent("progress", { step: "crawler", chars, outputTokens })
    );
    await trackTokens("CRAWL", crawlUsage, crawlerModel);
    if (crawlRepaired) await dbLog(runId, "ORCH", "Crawler response truncated — auto-repaired", "warn", sendEvent);

    // Scraped data is from the actual site — always wins over AI for fields it found
    crawlResult = mergeWithScraped(result, scraped);
  }

  if (!crawlResult.company_name) {
    await updateRun(runId, { status: "failed", error: "Crawler could not identify the company" }, sendEvent);
    sendEvent("error", { message: "Crawler could not identify the company" });
    return;
  }

  await updateRun(runId, { crawlerOutput: crawlResult }, sendEvent);
  sendEvent("step", { step: "crawler", status: "done" });
  sendEvent("output", { key: "crawler", data: crawlResult });
  await dbLog(runId, "CRAWL", `Found: ${crawlResult.company_name} — ${crawlResult.industry}`, "success", sendEvent);

  // ── UNSPLASH ENRICHMENT (if images missing) ────────────────────────────────

  const crawlImages = crawlResult.images as Record<string, unknown> | undefined;
  const hasHero = !!(crawlImages?.hero);
  const hasProducts = Array.isArray(crawlImages?.products) && (crawlImages.products as string[]).filter(Boolean).length > 0;

  if (!hasHero || !hasProducts) {
    await dbLog(runId, "CRAWL", `Images missing (hero: ${hasHero}, products: ${hasProducts}) — checking Unsplash...`, "info", sendEvent);
    const unsplash = await fetchUnsplashImages({
      companyName: crawlResult.company_name as string,
      industry: (crawlResult.industry as string) || "",
      productsServices: (crawlResult.products_services as string[]) || [],
      description: (crawlResult.description as string) || "",
    });

    if (unsplash) {
      const imgs = { ...(crawlImages || {}) } as Record<string, unknown>;
      // Fill gaps only — don't override existing images
      if (!hasHero && unsplash.hero) {
        imgs.hero = unsplash.hero;
        await dbLog(runId, "CRAWL", `Unsplash: added hero image`, "info", sendEvent);
      }
      if (!hasProducts && unsplash.products.length > 0) {
        imgs.products = unsplash.products;
        await dbLog(runId, "CRAWL", `Unsplash: added ${unsplash.products.length} product images`, "info", sendEvent);
      }
      imgs.unsplash_attribution = unsplash.attribution;
      crawlResult.images = imgs;
      // Update DB with enriched images
      await updateRun(runId, { crawlerOutput: crawlResult }, sendEvent);
      await dbLog(runId, "CRAWL", `Unsplash enrichment complete (${unsplash.attribution.length} photos)`, "success", sendEvent);
    } else {
      await dbLog(runId, "CRAWL", `Unsplash unavailable — continuing without stock photos`, "info", sendEvent);
    }
  }

  // ── CANCELLATION CHECK 3: After crawler, before planner ──
  await checkCancelled(runId, sendEvent);

  // ── PHASE 3: PLANNER ─────────────────────────────────────────────────────

  const plannerModel = agentModels.planner ?? MODELS.sonnet;
  await dbLog(runId, "ORCH", "Phase 3: Starting Planner", "info", sendEvent);
  await updateRun(runId, { currentStep: "planner" }, sendEvent);
  sendEvent("step", { step: "planner", status: "running" });
  await dbLog(runId, "PLAN", `Designing improvement strategy (${plannerModel})...`, "info", sendEvent);

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
    false,
    1,
    plannerModel,
    ({ chars, outputTokens }) => sendEvent("progress", { step: "planner", chars, outputTokens })
  );
  await trackTokens("PLAN", planUsage, plannerModel);
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

  // ── CANCELLATION CHECK 4: After planner, before generator ──
  await checkCancelled(runId, sendEvent);

  // ── PHASE 4: GENERATOR ───────────────────────────────────────────────────

  const generatorModel = agentModels.generator ?? MODELS.sonnet;
  await dbLog(runId, "ORCH", "Phase 4: Starting Generator", "info", sendEvent);
  await updateRun(runId, { currentStep: "generator" }, sendEvent);
  sendEvent("step", { step: "generator", status: "running" });
  await dbLog(runId, "GEN", `Building the new website (${generatorModel})...`, "info", sendEvent);

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
CANONICAL URL: ${targetUrl}
SEO KEYWORDS: ${(crawlResult.seo_keywords as string[])?.join(", ") || "N/A"}
SOCIAL LINKS: ${Object.entries((crawlResult.social_media as Record<string, string>) ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ") || "none"}
DESCRIPTION: ${crawlResult.description || "N/A"}
ACCESSIBILITY: ${(planResult.accessibility_plan as string[])?.join(", ") || "WCAG 2.1 AA defaults"}

IMAGES (use these exact URLs in <img> tags):
  Logo: ${images?.logo || "none — use text logo"}
  Hero: ${images?.hero || "none — use gradient/shapes"}
  Products: ${(images?.products as string[])?.filter(Boolean)?.join(", ") || "none"}
  Team: ${images?.team || "none"}
  Social cover: ${images?.social_cover || "none"}
  Additional: ${(images?.additional as string[])?.filter(Boolean)?.join(", ") || "none"}

Build an AWARD-WINNING, complete, production-ready HTML document. This should look like a $30k agency build. Use the REAL images above — do not invent image URLs. Include full SEO meta tags, Open Graph, Twitter Card, JSON-LD structured data, and WCAG 2.1 AA accessibility as specified in your instructions.`,
    false,
    32000,
    generatorModel,
    ({ chars, outputTokens }) => sendEvent("progress", { step: "generator", chars, outputTokens })
  );

  await trackTokens("GEN", genUsage, generatorModel);

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

  // ── CANCELLATION CHECK 5: After generator, before reeval ──
  await checkCancelled(runId, sendEvent);

  // ── PHASE 5: RE-EVALUATION ────────────────────────────────────────────────

  const reevalModel = agentModels.reeval ?? MODELS.haiku;
  await dbLog(runId, "ORCH", "Phase 5: Re-evaluating generated HTML (3 agents)", "info", sendEvent);
  await updateRun(runId, { currentStep: "reeval" }, sendEvent);
  sendEvent("step", { step: "reeval", status: "running" });

  const htmlForReeval = html.slice(0, 60_000);

  const runReEvalAgent = async (
    label: string,
    logKey: string,
    prompt: string,
  ): Promise<Record<string, unknown> | null> => {
    try {
      await dbLog(runId, logKey, `Re-eval ${label}: analyzing generated HTML (${reevalModel})...`, "info", sendEvent);
      const { result, usage } = await callClaudeJSON(
        prompt,
        `Analyze this HTML source code:\n\n${htmlForReeval}`,
        false,
        1,
        reevalModel,
        ({ chars, outputTokens }) => sendEvent("progress", { step: "reeval", chars, outputTokens })
      );
      await trackTokens(logKey, usage, reevalModel);
      await dbLog(runId, logKey, `Re-eval ${label} score: ${(result as Record<string, unknown>).overall_score}/100`, "success", sendEvent);
      return result;
    } catch (err) {
      await dbLog(runId, logKey, `Re-eval ${label} failed: ${err instanceof Error ? err.message : err}`, "error", sendEvent);
      return null;
    }
  };

  const [secReeval, codeReeval, viewReeval] = await Promise.all([
    runReEvalAgent("Security", "REEVAL", prompts.securityReeval),
    runReEvalAgent("Code", "REEVAL", prompts.codeReeval),
    runReEvalAgent("View", "REEVAL", prompts.viewReeval),
  ]);

  const reevalSuccess = [secReeval, codeReeval, viewReeval].filter(Boolean).length;
  if (reevalSuccess > 0) {
    const secAfter = (secReeval?.overall_score as number) ?? null;
    const codeAfter = (codeReeval?.overall_score as number) ?? null;
    const viewAfter = (viewReeval?.overall_score as number) ?? null;
    const afterScores = [secAfter, codeAfter, viewAfter].filter((s): s is number => s != null);
    const overallAfter = afterScores.length > 0 ? Math.round(afterScores.reduce((a, b) => a + b, 0) / afterScores.length) : null;

    const reEvalOutput = {
      security_after: secReeval,
      code_after: codeReeval,
      view_after: viewReeval,
      scores_after: {
        security: secAfter,
        code: codeAfter,
        view: viewAfter,
      },
      overall_after: overallAfter,
      improvement: overallAfter != null ? overallAfter - overallScore : null,
    };

    await updateRun(runId, { reEvalOutput }, sendEvent);
    sendEvent("output", { key: "reeval", data: reEvalOutput });
    await dbLog(
      runId, "ORCH",
      `Re-eval: ${overallAfter}/100 (before: ${overallScore}) ${overallAfter != null ? (overallAfter >= overallScore ? `+${overallAfter - overallScore}` : `${overallAfter - overallScore}`) : ""}`,
      "success", sendEvent
    );
  } else {
    await dbLog(runId, "ORCH", "Re-eval: all agents failed — skipping", "warn", sendEvent);
  }

  sendEvent("step", { step: "reeval", status: "done" });

  // ── PHASE 6: SPLIT FILES + FINALIZE ──────────────────────────────────────

  const { files } = splitFiles(html);
  const fileCount = Object.keys(files).length;
  await dbLog(runId, "ORCH", `Split into ${fileCount} files: ${Object.keys(files).join(", ")}`, "info", sendEvent);

  await updateRun(
    runId,
    { files, status: "completed", currentStep: null },
    sendEvent
  );

  await dbLog(runId, "ORCH", "Pipeline complete!", "success", sendEvent);
  sendEvent("complete", {
    scoreOverall: overallScore,
    files: Object.keys(files),
    tokens: { ...tokenTotals },
    estimatedCostUsd: totalCostUnits,
    costDisplay: formatCost(totalCostUnits),
  });

  } catch (err) {
    if (err instanceof PipelineCancelledError) {
      await updateRun(runId, { currentStep: null }, sendEvent);
      await dbLog(runId, "ORCH", "Pipeline cancelled by user", "warn", sendEvent);
      return;
    }
    throw err;
  }
}
