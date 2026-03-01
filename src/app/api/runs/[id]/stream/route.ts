import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { runPipeline } from "@/lib/pipeline";

export const maxDuration = 300;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) {
    return new Response("Run not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  // If already completed or failed, send current state and close
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `event: done\ndata: ${JSON.stringify({ status: run.status, scoreOverall: run.scoreOverall })}\n\n`
          )
        );
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // If already running, poll for updates instead of starting a second pipeline
  if (run.status === "running") {
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch { /* closed */ }
        };

        // Send initial snapshot so the UI can show current progress
        send("running", { status: "running", currentStep: run.currentStep });

        // Poll DB every 3s until pipeline finishes
        const poll = setInterval(async () => {
          try {
            const [latest] = await db.select().from(runs).where(eq(runs.id, id));
            if (!latest) { clearInterval(poll); controller.close(); return; }

            send("sync", {
              status: latest.status,
              currentStep: latest.currentStep,
              securityOutput: latest.securityOutput,
              codeOutput: latest.codeOutput,
              viewOutput: latest.viewOutput,
              mergedOutput: latest.mergedOutput,
              crawlerOutput: latest.crawlerOutput,
              plannerOutput: latest.plannerOutput,
              generatedHtml: !!latest.generatedHtml,
              reEvalOutput: latest.reEvalOutput,
              scoreOverall: latest.scoreOverall,
              totalInputTokens: latest.totalInputTokens,
              totalOutputTokens: latest.totalOutputTokens,
              totalTokens: latest.totalTokens,
              estimatedCostUsd: latest.estimatedCostUsd,
            });

            if (latest.status !== "running") {
              clearInterval(poll);
              send("done", { status: latest.status, scoreOverall: latest.scoreOverall });
              controller.close();
            }
          } catch {
            clearInterval(poll);
            try { controller.close(); } catch { /* already closed */ }
          }
        }, 3000);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Only start pipeline for "pending" runs
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Stream already closed
        }
      };

      try {
        await runPipeline(id, sendEvent);
      } catch (err) {
        sendEvent("error", {
          message: err instanceof Error ? err.message : "Pipeline failed",
        });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
