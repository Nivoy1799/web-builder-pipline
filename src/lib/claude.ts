import Anthropic from "@anthropic-ai/sdk";

export const MODELS = {
  sonnet: "claude-sonnet-4-20250514",
  haiku: "claude-haiku-4-5-20251001",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

const DEFAULT_MODEL = MODELS.sonnet;

const client = new Anthropic();

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

// Cost rates per million tokens
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  [MODELS.sonnet]: { input: 3.0, output: 12.0 },
  [MODELS.haiku]: { input: 0.8, output: 4.0 },
};

// Cost in 1/10000 dollar units (e.g. 50 = $0.005)
export function calculateCostUnits(usage: TokenUsage, model: ModelId = DEFAULT_MODEL): number {
  const rates = MODEL_COSTS[model] ?? MODEL_COSTS[DEFAULT_MODEL];
  const inputCost = (usage.inputTokens / 1_000_000) * rates.input;
  const outputCost = (usage.outputTokens / 1_000_000) * rates.output;
  return Math.round((inputCost + outputCost) * 10_000);
}

export function formatCost(costUnits: number): string {
  const dollars = costUnits / 10_000;
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}

export async function callClaude(
  system: string,
  userMessage: string,
  useSearch = true,
  maxTokens = 8192,
  model: ModelId = DEFAULT_MODEL
): Promise<{ text: string; wasTruncated: boolean; usage: TokenUsage }> {
  const systemSnippet = system.slice(0, 60).replace(/\n/g, " ");
  console.log(
    `→ API ${model} search:${useSearch} max:${maxTokens} — "${systemSnippet}…"`
  );

  const MAX_RATE_RETRIES = 3;
  let response: Anthropic.Message | undefined;

  for (let r = 0; r < MAX_RATE_RETRIES; r++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any = {
        model,
        max_tokens: maxTokens,
        system: [
          {
            type: "text",
            text: system,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userMessage }],
      };
      if (useSearch) {
        params.tools = [
          { type: "web_search_20250305", name: "web_search" },
        ];
      }
      response = await client.messages.create(params);
      break;
    } catch (err) {
      if (
        err instanceof Anthropic.RateLimitError &&
        r < MAX_RATE_RETRIES - 1
      ) {
        const retryAfter = 30;
        console.log(
          `⏳ Rate limited — waiting ${retryAfter}s then retry (${r + 1}/${MAX_RATE_RETRIES})`
        );
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      throw err;
    }
  }

  if (!response) throw new Error("API call failed after retries");

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usageAny = response.usage as any;
  const cacheInfo = usageAny.cache_read_input_tokens
    ? ` cache_read:${usageAny.cache_read_input_tokens}`
    : "";
  console.log(
    `✓ tokens in:${response.usage.input_tokens} out:${response.usage.output_tokens}${cacheInfo} stop:${response.stop_reason}`
  );

  const usage: TokenUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
  };

  return { text, wasTruncated: response.stop_reason === "max_tokens", usage };
}

export function repairJSON(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {}

  let s = str.replace(/```json|```/g, "").trim();
  const start = s.indexOf("{");
  if (start === -1) throw new Error("No JSON object found");
  s = s.slice(start);
  try {
    return JSON.parse(s);
  } catch {}

  // Remove trailing incomplete key-value pairs
  s = s.replace(/,\s*"[^"]*"?\s*:?\s*("?[^"{}[\]]*)?$/, "");
  s = s.replace(/,\s*$/, "").replace(/,\s*"[^"]*$/, "");

  // Count and close open brackets
  let openB = 0,
    openK = 0,
    inStr = false,
    esc = false;
  for (const ch of s) {
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "{") openB++;
    if (ch === "}") openB--;
    if (ch === "[") openK++;
    if (ch === "]") openK--;
  }

  if (inStr) s += '"';
  for (let i = 0; i < openK; i++) s += "]";
  for (let i = 0; i < openB; i++) s += "}";
  s = s.replace(/,(\s*[}\]])/g, "$1");

  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(
      `JSON repair failed: ${e instanceof Error ? e.message : e}`
    );
  }
}

export async function callClaudeJSON(
  system: string,
  userMessage: string,
  useSearch = true,
  retries = 1,
  model: ModelId = DEFAULT_MODEL
): Promise<{ result: Record<string, unknown>; wasTruncated: boolean; repaired: boolean; usage: TokenUsage }> {
  let msg = userMessage;
  const accUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { text, wasTruncated, usage } = await callClaude(
      system,
      msg,
      useSearch,
      8192,
      model
    );
    accUsage.inputTokens += usage.inputTokens;
    accUsage.outputTokens += usage.outputTokens;
    accUsage.totalTokens += usage.totalTokens;
    try {
      return {
        result: repairJSON(text) as Record<string, unknown>,
        wasTruncated,
        repaired: wasTruncated,
        usage: accUsage,
      };
    } catch (e) {
      if (attempt < retries) {
        msg +=
          "\n\nCRITICAL: Keep response VERY concise. Short strings. Must be valid complete JSON.";
        continue;
      }
      throw new Error(
        `JSON parse failed: ${e instanceof Error ? e.message : e}`
      );
    }
  }
  throw new Error("Unreachable");
}

export function parseHTML(text: string): string {
  const clean = text.replace(/```html|```/g, "").trim();
  const m =
    clean.match(/<!DOCTYPE[\s\S]*<\/html>/i) ||
    clean.match(/<html[\s\S]*<\/html>/i);
  if (m) return m[0];
  if (clean.includes("<head") || clean.includes("<body")) return clean;
  throw new Error("No HTML found in response");
}
