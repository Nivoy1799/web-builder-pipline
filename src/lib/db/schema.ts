import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  serial,
  pgEnum,
} from "drizzle-orm/pg-core";

export const runStatusEnum = pgEnum("run_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  status: runStatusEnum("status").notNull().default("pending"),
  currentStep: text("current_step"),
  securityOutput: jsonb("security_output"),
  codeOutput: jsonb("code_output"),
  viewOutput: jsonb("view_output"),
  mergedOutput: jsonb("merged_output"),
  crawlerOutput: jsonb("crawler_output"),
  plannerOutput: jsonb("planner_output"),
  generatedHtml: text("generated_html"),
  reEvalOutput: jsonb("reeval_output"),
  files: jsonb("files"),
  scoreOverall: integer("score_overall"),
  totalInputTokens: integer("total_input_tokens").notNull().default(0),
  totalOutputTokens: integer("total_output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCostUsd: integer("estimated_cost_usd").notNull().default(0),
  config: jsonb("config"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const runLogs = pgTable("run_logs", {
  id: serial("id").primaryKey(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  agent: text("agent").notNull(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  data: jsonb("data"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type RunLog = typeof runLogs.$inferSelect;
