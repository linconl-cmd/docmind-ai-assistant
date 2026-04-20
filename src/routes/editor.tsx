import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useDocuments } from "@/hooks/useDocuments";
import { useChat } from "@/hooks/useChat";
import { useBilling } from "@/hooks/useBilling";

import { EditorSidebar } from "@/components/editor/EditorSidebar";
import { PDFViewer } from "@/components/editor/PDFViewer";
import { ChatPanel } from "@/components/editor/ChatPanel";
import { PlanUpgradeModal } from "@/components/ui/PlanUpgradeModal";
import { useToast } from "@/components/ui/Toast";

import type { EditChange, AppDocument, Plan } from "@/types";

export const Route = createFileRoute("/editor")({
  component: EditorPage,
});

function EditorPage() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const { show } = useToast();

  const docs = useDocuments();
  const billing = useBilling();
  const [flashedKeys, setFlashedKeys] = useState<Set<string>>(new Set());
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Auth gate
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  const flashKeys = useCallback((keys: string[]) => {
    setFlashedKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
    setTimeout(() => {
      setFlashedKeys((prev) => {
        const next = new Set(prev);
        keys.forEach((k) => next.delete(k));
        return next;
      });
    }, 3100);
  }, []);

  const applyEdits = useCallback(
    (edits: EditChange[]) => {
      if (edits.length === 0 || !docs.selectedDocument) return;

      docs.updateDocumentSections(docs.selectedDocument.id, (doc): AppDocument => {
        const sections = (doc.sections ?? []).map((sec) => {
          if (sec.kind === "fields" && sec.fields) {
            return {
              ...sec,
              fields: sec.fields.map((f) => {
                const e = edits.find((x) => x.campo === f.key);
                return e ? { ...f, value: e.valor_novo } : f;
              }),
            };
          }
          if (sec.kind === "table" && sec.table) {
            const seniorEdit = edits.find((x) => x.campo === "table-valores-senior");
            const mensalEdit = edits.find((x) => x.campo === "table-valores-mensalidade");
            return {
              ...sec,
              table: {
                ...sec.table,
                rows: sec.table.rows.map((r) => {
                  const desc = String(r["Descrição"] ?? "").toLowerCase();
                  if (seniorEdit && desc.includes("sênior")) {
                    const novoUnit = seniorEdit.valor_novo;
                    const total = `R$ ${(320 * 40).toLocaleString("pt-BR")},00`;
                    return { ...r, "Valor unitário": novoUnit, Total: total };
                  }
                  if (mensalEdit && desc.includes("mensalidade")) {
                    return { ...r, "Valor unitário": mensalEdit.valor_novo, Total: mensalEdit.valor_novo };
                  }
                  return r;
                }),
              },
            };
          }
          return sec;
        });
        return { ...doc, sections, edit_count: doc.edit_count + 1 };
      });

      flashKeys(edits.map((e) => e.campo));
    },
    [docs, flashKeys],
  );

  const chat = useChat({
    doc: docs.selectedDocument,
    canEdit: billing.canEdit,
    onApplyEdits: applyEdits,
    onBlocked: () => setUpgradeOpen(true),
    onAfterEdit: async (cost) => {
      if (!docs.selectedDocument) return;
      // increment edit count in DB for real docs
      if (!docs.selectedDocument.id.startsWith("doc-sample")) {
        await docs.incrementEditCount(docs.selectedDocument.id);
      }
      await billing.logEdit({
        documentId: docs.selectedDocument.id.startsWith("doc-sample") ? undefined : docs.selectedDocument.id,
        prompt: cost.prompt,
        model: cost.model,
        tokens_input: cost.tokens_input,
        tokens_output: cost.tokens_output,
        cost_usd: cost.cost_usd,
      });
    },
  });

  const handleUpgrade = async (plan: Plan) => {
    try {
      await billing.upgradePlan(plan);
      setUpgradeOpen(false);
      show(`Plano alterado para ${plan.toUpperCase()}.`, "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Erro ao trocar plano", "error");
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <EditorSidebar
        documents={docs.documents}
        selectedId={docs.selectedDocument?.id ?? null}
        onSelect={docs.selectDocument}
        onUpload={docs.uploadDocument}
        onUpgrade={() => setUpgradeOpen(true)}
        plan={billing.plan}
        isAdmin={profile?.role === "admin"}
      />
      <PDFViewer doc={docs.selectedDocument} flashedKeys={flashedKeys} />
      <ChatPanel
        messages={chat.messages}
        isTyping={chat.isTyping}
        suggestions={chat.suggestions}
        onSend={chat.sendMessage}
      />
      <PlanUpgradeModal
        isOpen={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        onSelect={handleUpgrade}
        currentPlan={billing.plan}
      />
    </div>
  );
}
