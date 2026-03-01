import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runs, runLogs } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const logs = await db
    .select()
    .from(runLogs)
    .where(eq(runLogs.runId, id))
    .orderBy(asc(runLogs.createdAt));

  return NextResponse.json({ ...run, logs });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  if (body.action !== "cancel") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  if (run.status !== "running") {
    return NextResponse.json({ error: "Run is not running" }, { status: 409 });
  }

  await db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, id));
  return NextResponse.json({ ok: true, status: "cancelled" });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await db.delete(runs).where(eq(runs.id, id));
  return NextResponse.json({ ok: true });
}
