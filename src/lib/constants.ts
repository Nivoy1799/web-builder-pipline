export const CAT_LABELS = {
  // Security
  https_tls: "HTTPS & TLS",
  security_headers: "Security Headers",
  cookie_security: "Cookie Security",
  input_validation: "Input Validation",
  authentication: "Authentication",
  mixed_content: "Mixed Content",
  information_disclosure: "Info Disclosure",
  third_party_risk: "3rd Party Risk",
  // Code
  semantic_html: "Semantic HTML",
  seo_meta: "SEO & Meta",
  performance: "Performance",
  accessibility_code: "Accessibility",
  responsive_code: "Responsive CSS",
  code_quality: "Code Quality",
  standards_compliance: "Standards",
  asset_optimization: "Asset Optimization",
  // View
  visual_hierarchy: "Visual Hierarchy",
  typography: "Typography",
  color_palette: "Color Palette",
  navigation_ux: "Navigation UX",
  cta_conversion: "CTA & Conversion",
  whitespace_density: "Whitespace",
  consistency_design: "Consistency",
  overall_polish: "Overall Polish",
} as const;

export const CAT_ICONS: Record<string, string> = {
  https_tls: "🔒",
  security_headers: "🛡",
  cookie_security: "🍪",
  input_validation: "📝",
  authentication: "🔑",
  mixed_content: "⚠",
  information_disclosure: "👁",
  third_party_risk: "📦",
  semantic_html: "🏗",
  seo_meta: "🔍",
  performance: "⚡",
  accessibility_code: "♿",
  responsive_code: "📱",
  code_quality: "💎",
  standards_compliance: "✓",
  asset_optimization: "🗜",
  visual_hierarchy: "◈",
  typography: "Aa",
  color_palette: "◐",
  navigation_ux: "⌘",
  cta_conversion: "→",
  whitespace_density: "□",
  consistency_design: "≡",
  overall_polish: "★",
};

export const PIPELINE_STEPS = [
  "security",
  "code",
  "view",
  "merge",
  "crawler",
  "planner",
  "generator",
  "reeval",
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];
export type StepStatus = "pending" | "running" | "done" | "error";

export const INITIAL_STATUSES: Record<PipelineStep, StepStatus> =
  Object.fromEntries(PIPELINE_STEPS.map((s) => [s, "pending"])) as Record<
    PipelineStep,
    StepStatus
  >;

export const AGENT_COLORS: Record<string, string> = {
  ORCH: "#94a3b8",
  SEC: "#ef4444",
  CODE: "#f59e0b",
  VIEW: "#3b82f6",
  CRAWL: "#a78bfa",
  PLAN: "#8b5cf6",
  GEN: "#22c55e",
  REEVAL: "#06b6d4",
};
