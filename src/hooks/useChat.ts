import { useCallback, useState } from "react";
import type { ChatMessage, EditChange, AppDocument } from "@/types";
import { supabase } from "@/integrations/supabase/client";
import { editDocumentFn } from "@/server/edit-document";

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

      if (!doc) {
        setMessages((m) => [
          ...m,
          {
            id: Math.random().toString(36).slice(2),
            role: "ai",
            content: "Nenhum documento carregado.",
            timestamp: new Date(),
          },
        ]);
        return;
      }

      setIsTyping(true);

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error("Sessão expirada. Faça login novamente.");

        const history = messages
          .filter((m) => m.id !== "welcome")
          .map((m) => ({
            role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
            content: m.content,
          }));

        const result = await editDocumentFn({
          data: { prompt: trimmed, doc, history },
          headers: { Authorization: `Bearer ${token}` },
        });

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

        if (result.edits.length > 0) {
          await onAfterEdit?.({
            tokens_input: result.tokens_input,
            tokens_output: result.tokens_output,
            cost_usd: result.cost_usd,
            model: result.model,
            prompt: trimmed,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao processar edição.";
        setMessages((m) => [
          ...m,
          {
            id: Math.random().toString(36).slice(2),
            role: "ai",
            content: `Não consegui processar sua solicitação: ${msg}`,
            timestamp: new Date(),
          },
        ]);
      } finally {
        setIsTyping(false);
      }
    },
    [canEdit, doc, messages, onApplyEdits, onAfterEdit, onBlocked],
  );

  const suggestions = [
    "Trocar data de término para agosto/2026",
    "Mudar valor por hora sênior",
    "Alterar contratante",
    "Ativar renovação automática",
  ];

  return { messages, isTyping, sendMessage, suggestions };
}
