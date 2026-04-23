import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AppDocument, EditChange } from "@/types";

const MODEL = "claude-haiku-4-5";
const MAX_TOKENS_OUTPUT = 4096;
const MAX_INPUT_CHARS = 32000;

const PRICE_PER_1M = { input: 1.0, output: 5.0 };

interface HistoryMsg {
  role: "user" | "assistant";
  content: string;
}

interface EditRequest {
  prompt: string;
  doc: AppDocument;
  history?: HistoryMsg[];
}

interface EditResponse {
  edits: EditChange[];
  reply: string;
  tokens_input: number;
  tokens_output: number;
  cost_usd: number;
  model: string;
}

function buildFieldsDigest(doc: AppDocument): {
  digest: string;
  keys: Set<string>;
  fieldMap: Map<string, { label: string; value: string }>;
} {
  const keys = new Set<string>();
  const fieldMap = new Map<string, { label: string; value: string }>();
  const lines: string[] = [];

  for (const section of doc.sections ?? []) {
    lines.push(`## ${section.title}`);
    if (section.kind === "fields" && section.fields) {
      for (const f of section.fields) {
        keys.add(f.key);
        fieldMap.set(f.key, { label: f.label, value: f.value });
        lines.push(`- key="${f.key}" | label="${f.label}" | valor_atual="${f.value}"`);
      }
    } else if (section.kind === "table" && section.table) {
      const cols = section.table.columns;
      section.table.rows.forEach((row, rIdx) => {
        cols.forEach((col) => {
          const key = `${section.id}-r${rIdx}-${col}`;
          const val = row[col] ?? "";
          keys.add(key);
          fieldMap.set(key, { label: `${section.title} — ${col} (linha ${rIdx + 1})`, value: val });
          lines.push(`- key="${key}" | label="${col} linha ${rIdx + 1}" | valor_atual="${val}"`);
        });
      });
    }
  }

  return { digest: lines.join("\n"), keys, fieldMap };
}

export const editDocumentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: EditRequest) => data)
  .handler(async ({ data }): Promise<EditResponse> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Response("Servidor não configurado: ANTHROPIC_API_KEY ausente.", { status: 500 });
    }

    const { prompt, doc, history = [] } = data;
    if (!prompt?.trim()) {
      throw new Response("Prompt vazio.", { status: 400 });
    }
    if (!doc) {
      throw new Response("Documento ausente.", { status: 400 });
    }

    const { digest, keys, fieldMap } = buildFieldsDigest(doc);

    if (digest.length > MAX_INPUT_CHARS) {
      throw new Response("Documento muito grande para o beta. Limite: ~8K tokens.", { status: 413 });
    }

    const anthropic = new Anthropic({ apiKey });

    const systemPrompt = `Você é o assistente de edição do DocMind, um SaaS jurídico brasileiro.

Seu trabalho: interpretar pedidos em português e retornar edições estruturadas via a tool "apply_edits".

REGRAS CRÍTICAS:
1. Use SOMENTE as keys listadas no documento abaixo. Nunca invente keys.
2. Preserve o formato do valor atual (datas em dd/mm/aaaa, valores em "R$ X.XXX,XX", etc).
3. Se o usuário pedir uma data específica, use EXATAMENTE a data pedida — não invente valores.
4. Se a intenção estiver AMBÍGUA (ex: "alterar total" mas há 3 linhas, "mudar data" sem dizer qual, "R$ 500" sem dizer o campo), retorne edits=[] e faça UMA pergunta curta e objetiva no reply, listando as opções numeradas. Ex: "Qual linha? 1) Hora sênior, 2) Hora pleno, 3) Mensalidade".
5. MANTENHA O CONTEXTO DA CONVERSA: se você perguntou "qual linha?" e o usuário responder "1", interprete como a opção 1 que você acabou de oferecer. Use o histórico para resolver referências ("essa", "a primeira", "a de cima", números soltos, etc).
6. Só retorne edits=[] quando não entendeu; nunca aplique uma edição chutando — prefira perguntar.
7. O campo "reply" deve ser curto (1-3 frases) em português.

DOCUMENTO ATUAL:
${digest}`;

    const tool: Anthropic.Tool = {
      name: "apply_edits",
      description: "Aplica edições ao documento e retorna uma mensagem de confirmação.",
      input_schema: {
        type: "object",
        properties: {
          edits: {
            type: "array",
            description: "Lista de edições a aplicar. Vazio se não entendeu o pedido.",
            items: {
              type: "object",
              properties: {
                campo: { type: "string", description: "A key exata do campo no documento." },
                valor_novo: { type: "string", description: "O novo valor, no mesmo formato do atual." },
              },
              required: ["campo", "valor_novo"],
            },
          },
          reply: {
            type: "string",
            description: "Mensagem curta em português para o usuário.",
          },
        },
        required: ["edits", "reply"],
      },
    };

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS_OUTPUT,
      system: systemPrompt,
      tools: [tool],
      tool_choice: { type: "tool", name: "apply_edits" },
      messages: [
        ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: prompt },
      ],
    });

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      throw new Response("Resposta inválida do modelo.", { status: 502 });
    }

    const input = toolBlock.input as { edits: Array<{ campo: string; valor_novo: string }>; reply: string };

    const validEdits: EditChange[] = [];
    for (const e of input.edits ?? []) {
      if (!keys.has(e.campo)) continue;
      const current = fieldMap.get(e.campo)!;
      if (current.value === e.valor_novo) continue;
      validEdits.push({
        campo: e.campo,
        campo_label: current.label,
        valor_antigo: current.value,
        valor_novo: e.valor_novo,
      });
    }

    const tokens_input = response.usage.input_tokens;
    const tokens_output = response.usage.output_tokens;
    const cost_usd =
      (tokens_input / 1_000_000) * PRICE_PER_1M.input +
      (tokens_output / 1_000_000) * PRICE_PER_1M.output;

    return {
      edits: validEdits,
      reply: input.reply || (validEdits.length > 0 ? `Apliquei ${validEdits.length} alteração(ões).` : "Não identifiquei o campo."),
      tokens_input,
      tokens_output,
      cost_usd,
      model: MODEL,
    };
  });
