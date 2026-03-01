import { db } from "@/lib/db";
import { runs, runLogs } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PipelineView } from "@/components/PipelineView";

export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) notFound();

  const logs = await db
    .select()
    .from(runLogs)
    .where(eq(runLogs.runId, id))
    .orderBy(asc(runLogs.createdAt));

  const initialRun = {
    id: run.id,
    url: run.url,
    status: run.status,
    currentStep: run.currentStep,
    securityOutput: run.securityOutput,
    codeOutput: run.codeOutput,
    viewOutput: run.viewOutput,
    mergedOutput: run.mergedOutput,
    crawlerOutput: run.crawlerOutput,
    plannerOutput: run.plannerOutput,
    generatedHtml: run.generatedHtml,
    files: run.files as Record<string, string> | null,
    scoreOverall: run.scoreOverall,
    totalInputTokens: run.totalInputTokens,
    totalOutputTokens: run.totalOutputTokens,
    totalTokens: run.totalTokens,
    estimatedCostUsd: run.estimatedCostUsd,
    error: run.error,
    logs: logs.map((l) => ({
      agent: l.agent,
      level: l.level,
      message: l.message,
      createdAt: l.createdAt.toISOString(),
    })),
  };

  return <PipelineView runId={id} initialRun={initialRun} />;
}
