import { useCallback, useState } from "react";
import { ADMIN_CLIENTS_MOCK, ADMIN_STATS_MOCK, SAMPLE_API_RESPONSE_JSON } from "@/lib/mocks";
import type { AdminClient, AdminStats } from "@/types";

interface TestPromptParams {
  systemPrompt: string;
  pdfContext: string;
  userMessage: string;
  model: string;
}

export interface TestPromptResult {
  rawText: string;
  parsed: unknown;
  tokens_input: number;
  tokens_output: number;
  cost_usd: number;
  duration_ms: number;
  model: string;
  ok: boolean;
  timestamp: Date;
}

const COSTS: Record<string, { in: number; out: number }> = {
  "claude-haiku-4.5": { in: 0.0008, out: 0.004 },
  "claude-sonnet-4.6": { in: 0.003, out: 0.015 },
  "claude-opus-4.6":   { in: 0.015, out: 0.075 },
};

export function useAdmin() {
  const [stats] = useState<AdminStats>(ADMIN_STATS_MOCK);
  const [clients] = useState<AdminClient[]>(ADMIN_CLIENTS_MOCK);
  const [history, setHistory] = useState<TestPromptResult[]>([]);
  const [running, setRunning] = useState(false);

  const testPrompt = useCallback(async (params: TestPromptParams) => {
    setRunning(true);
    const start = performance.now();
    await new Promise((r) => setTimeout(r, 1100 + Math.random() * 400));
    const duration_ms = Math.round(performance.now() - start);

    const tokens_input = Math.max(220, params.systemPrompt.length / 4 + params.pdfContext.length / 4 + params.userMessage.length / 4) | 0;
    const tokens_output = 180 + Math.round(Math.random() * 80);
    const cost = COSTS[params.model] ?? COSTS["claude-haiku-4.5"];
    const cost_usd = (tokens_input / 1000) * cost.in + (tokens_output / 1000) * cost.out;
    const parsed = SAMPLE_API_RESPONSE_JSON;

    const result: TestPromptResult = {
      rawText: JSON.stringify(parsed, null, 2),
      parsed,
      tokens_input,
      tokens_output,
      cost_usd,
      duration_ms,
      model: params.model,
      ok: true,
      timestamp: new Date(),
    };
    setHistory((h) => [result, ...h].slice(0, 8));
    setRunning(false);
    return result;
  }, []);

  return { stats, clients, history, running, testPrompt };
}
