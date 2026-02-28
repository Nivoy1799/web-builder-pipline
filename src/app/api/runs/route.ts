import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { normalizeUrl } from "@/lib/utils";

export async function GET() {
  const allRuns = await db
    .select({
      id: runs.id,
      url: runs.url,
      status: runs.status,
      currentStep: runs.currentStep,
      scoreOverall: runs.scoreOverall,
      error: runs.error,
      createdAt: runs.createdAt,
      updatedAt: runs.updatedAt,
    })
    .from(runs)
    .orderBy(desc(runs.createdAt));

  return NextResponse.json(allRuns);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const url = normalizeUrl(body.url || "");
  if (!url) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  const [run] = await db
    .insert(runs)
    .values({ url })
    .returning({ id: runs.id });

  return NextResponse.json({ id: run.id }, { status: 201 });
}
