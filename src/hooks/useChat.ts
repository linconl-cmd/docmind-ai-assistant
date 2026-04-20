import { useCallback, useState } from "react";
import type { ChatMessage, EditChange, AppDocument } from "@/types";

const MODELS = ["claude-haiku-4.5", "claude-sonnet-4.6"] as const;
const COST_PER_1K = { input: 0.0008, output: 0.004 };

interface SimulateOutput {
  edits: EditChange[];
  reply: string;
  tokens_input: number;
  tokens_output: number;
  cost_usd: number;
  model: string;
}

/**
 * Mock IA: detects keywords, returns simulated edits matching the document's fields.
 */
function simulate(prompt: string, doc: AppDocument | null): SimulateOutput {
  const lower = prompt.toLowerCase();
  const edits: EditChange[] = [];
  const sections = doc?.sections ?? [];

  const findField = (key: string) => {
    for (const s of sections) {
      const f = s.fields?.find((x) => x.key === key);
      if (f) return f;
    }
    return undefined;
  };

  const tryDateChange = () => {
    if (/(t[eé]rmino|fim|encerra|prazo final|data final)/.test(lower)) {
      const f = findField("f-termino");
      if (f) edits.push({ campo: "f-termino", campo_label: f.label, valor_antigo: f.value, valor_novo: "01/08/2026" });
    }
    if (/(in[ií]cio|come[çc]o|data inicial|start)/.test(lower)) {
      const f = findField("f-inicio");
      if (f) edits.push({ campo: "f-inicio", campo_label: f.label, valor_antigo: f.value, valor_novo: "15/03/2025" });
    }
  };

  const tryRenewal = () => {
    if (/(renova[çc][ãa]o|auto[- ]?renew)/.test(lower)) {
      const f = findField("f-renovacao");
      if (f) edits.push({ campo: "f-renovacao", campo_label: f.label, valor_antigo: f.value, valor_novo: "Sim, por períodos iguais e sucessivos de 12 meses" });
    }
  };

  const tryValueChange = () => {
    if (/(valor por hora|hora s[êe]nior|valor hora|valor unit[áa]rio)/.test(lower)) {
      // Mock: bump senior hour rate
      edits.push({
        campo: "table-valores-senior",
        campo_label: "Valor unitário — Hora consultoria sênior",
        valor_antigo: "R$ 280,00",
        valor_novo: "R$ 320,00",
      });
    }
    if (/(mensalidade|fixo mensal|valor fixo)/.test(lower)) {
      edits.push({
        campo: "table-valores-mensalidade",
        campo_label: "Valor unitário — Mensalidade fixa",
        valor_antigo: "R$ 4.500,00",
        valor_novo: "R$ 5.200,00",
      });
    }
    if (/(multa|atraso|juros)/.test(lower)) {
      const f = findField("f-multa");
      if (f) edits.push({ campo: "f-multa", campo_label: f.label, valor_antigo: f.value, valor_novo: "5% + juros 1% ao mês" });
    }
  };

  const tryParties = () => {
    if (/(contratante|cliente)/.test(lower)) {
      const f = findField("f-contratante");
      if (f) edits.push({ campo: "f-contratante", campo_label: f.label, valor_antigo: f.value, valor_novo: "Globex Indústria S.A. — CNPJ 11.222.333/0001-44" });
    }
    if (/(contratada|prestador)/.test(lower)) {
      const f = findField("f-contratada");
      if (f) edits.push({ campo: "f-contratada", campo_label: f.label, valor_antigo: f.value, valor_novo: "Stark & Associados ME — CNPJ 55.666.777/0001-88" });
    }
  };

  tryDateChange(); tryRenewal(); tryValueChange(); tryParties();

  const tokens_input = Math.max(180, prompt.length * 4);
  const tokens_output = edits.length > 0 ? 220 : 80;
  const cost_usd =
    (tokens_input / 1000) * COST_PER_1K.input + (tokens_output / 1000) * COST_PER_1K.output;

  let reply: string;
  if (edits.length === 0) {
    reply =
      "Não consegui identificar com clareza qual campo você quer alterar. Tente algo como “mudar a data de término para agosto/2026” ou “trocar o valor da hora sênior”.";
  } else {
    reply = `Apliquei ${edits.length} alteraç${edits.length === 1 ? "ão" : "ões"} no documento. Revise o painel central — os campos editados estão destacados em verde.`;
  }

  return { edits, reply, tokens_input, tokens_output, cost_usd, model: MODELS[0] };
}

export interface UseChatOptions {
  doc: AppDocument | null;
  onApplyEdits: (edits: EditChange[]) => void;
  onAfterEdit?: (cost: { tokens_input: number; tokens_output: number; cost_usd: number; model: string; prompt: string }) => Promise<void>;
  onBlocked?: () => void;
  canEdit: boolean;
}

export function useChat({ doc, onApplyEdits, onAfterEdit, onBlocked, canEdit }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "ai",
      content:
        "Olá! Sou o assistente do DocMind. Diga em linguagem natural o que você quer alterar no contrato — datas, valores, partes, cláusulas — e eu cuido do resto.",
      timestamp: new Date(),
    },
  ]);
  const [isTyping, setIsTyping] = useState(false);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const userMsg: ChatMessage = {
        id: Math.random().toString(36).slice(2),
        role: "user",
        content: trimmed,
        timestamp: new Date(),
      };
      setMessages((m) => [...m, userMsg]);

      if (!canEdit) {
        onBlocked?.();
        setMessages((m) => [
          ...m,
          {
            id: Math.random().toString(36).slice(2),
            role: "ai",
            content:
              "Você atingiu o limite gratuito deste mês (1 edição). Faça upgrade para continuar editando.",
            timestamp: new Date(),
          },
        ]);
        return;
      }

      setIsTyping(true);
      await new Promise((r) => setTimeout(r, 1100 + Math.random() * 500));

      const result = simulate(trimmed, doc);
      onApplyEdits(result.edits);

      const aiMsg: ChatMessage = {
        id: Math.random().toString(36).slice(2),
        role: "ai",
        content: result.reply,
        edits: result.edits,
        cost_usd: result.cost_usd,
        tokens: result.tokens_input + result.tokens_output,
        timestamp: new Date(),
      };
      setMessages((m) => [...m, aiMsg]);
      setIsTyping(false);

      if (result.edits.length > 0) {
        await onAfterEdit?.({
          tokens_input: result.tokens_input,
          tokens_output: result.tokens_output,
          cost_usd: result.cost_usd,
          model: result.model,
          prompt: trimmed,
        });
      }
    },
    [canEdit, doc, onApplyEdits, onAfterEdit, onBlocked],
  );

  const suggestions = [
    "Trocar data de término para agosto/2026",
    "Mudar valor por hora sênior",
    "Alterar contratante",
    "Ativar renovação automática",
  ];

  return { messages, isTyping, sendMessage, suggestions };
}
