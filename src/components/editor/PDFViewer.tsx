import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { supabase } from "@/integrations/supabase/client";
import { getDocumentUrlFn } from "@/server/get-document-url";
import { cn } from "@/lib/cn";
import type { AppDocument, DocSection } from "@/types";

interface PDFViewerProps {
  doc: AppDocument | null;
  flashedKeys: Set<string>;
  onSaveSections: (docId: string, sections: DocSection[]) => Promise<void> | void;
}

export function PDFViewer({ doc, flashedKeys, onSaveSections }: PDFViewerProps) {
  const { show } = useToast();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<DocSection[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(null);
  }, [doc?.id]);

  useEffect(() => {
    setPdfUrl(null);
    if (!doc?.id || !doc.storage_path) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) return;
        const result = await getDocumentUrlFn({
          data: { docId: doc.id },
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) setPdfUrl(result.url);
      } catch {
        if (!cancelled) setPdfUrl(null);
      }
    })();
    return () => { cancelled = true; };
  }, [doc?.id, doc?.storage_path]);

  const displayedSections = draft ?? doc?.sections ?? [];
  const dirty = draft !== null;

  const canonicalEqual = useMemo(() => {
    if (!draft || !doc?.sections) return true;
    return JSON.stringify(draft) === JSON.stringify(doc.sections);
  }, [draft, doc?.sections]);

  if (!doc) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Selecione ou faça upload de um documento.
      </div>
    );
  }

  const isProcessing = doc.status === "extracting" || doc.status === "uploading";
  const isError = doc.status === "error";

  const startEdit = () => {
    if (!draft) setDraft(JSON.parse(JSON.stringify(doc.sections ?? [])));
  };

  const updateField = (sectionIdx: number, fieldIdx: number, value: string) => {
    startEdit();
    setDraft((prev) => {
      const next = prev ? [...prev] : JSON.parse(JSON.stringify(doc.sections ?? []));
      const sec = { ...next[sectionIdx] };
      if (sec.fields) {
        sec.fields = [...sec.fields];
        sec.fields[fieldIdx] = { ...sec.fields[fieldIdx], value };
      }
      next[sectionIdx] = sec;
      return next;
    });
  };

  const updateCell = (sectionIdx: number, rowIdx: number, col: string, value: string) => {
    startEdit();
    setDraft((prev) => {
      const next = prev ? [...prev] : JSON.parse(JSON.stringify(doc.sections ?? []));
      const sec = { ...next[sectionIdx] };
      if (sec.table) {
        const rows = [...sec.table.rows];
        rows[rowIdx] = { ...rows[rowIdx], [col]: value };
        sec.table = { ...sec.table, rows };
      }
      next[sectionIdx] = sec;
      return next;
    });
  };

  const handleSave = async () => {
    if (!draft || !doc) return;
    setSaving(true);
    try {
      await onSaveSections(doc.id, draft);
      setDraft(null);
      show("Alterações salvas.", "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Erro ao salvar", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setDraft(null);
  };

  const handleDownload = () => {
    show("Exportação do PDF editado em breve.", "info");
  };

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <div className="h-14 px-6 flex items-center justify-between border-b-hairline bg-surface-1">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{doc.filename}</span>
          <span className="text-xs text-muted-foreground shrink-0">· {doc.pages || "?"} págs</span>
          {isProcessing && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              <Loader2 className="h-3 w-3 animate-spin" /> processando
            </span>
          )}
          {isError && <span className="text-xs text-destructive shrink-0">· erro na extração</span>}
          {dirty && !canonicalEqual && (
            <span className="text-xs text-warning shrink-0">· alterações não salvas</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dirty && !canonicalEqual && (
            <>
              <Button size="sm" variant="ghost" leftIcon={<X className="h-4 w-4" />} onClick={handleDiscard} disabled={saving}>
                Descartar
              </Button>
              <Button size="sm" variant="primary" leftIcon={<Save className="h-4 w-4" />} onClick={handleSave} loading={saving}>
                Salvar alterações
              </Button>
            </>
          )}
          {!dirty && doc.edit_count > 0 && (
            <Button size="sm" variant="subtle" leftIcon={<Download className="h-4 w-4" />} onClick={handleDownload}>
              Baixar PDF editado
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 overflow-hidden">
        <div className="border-r-hairline bg-neutral-900/5 dark:bg-black/40 overflow-hidden">
          {pdfUrl ? (
            <iframe src={pdfUrl} title={doc.filename} className="w-full h-full" style={{ border: 0 }} />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              {doc.storage_path ? "Carregando PDF..." : "Prévia indisponível"}
            </div>
          )}
        </div>

        <div className="overflow-y-auto px-6 py-6 bg-background">
          <div className="max-w-xl mx-auto space-y-5">
            {isProcessing && (
              <div className="text-center text-sm text-muted-foreground py-10 bg-surface-1 rounded-xl border-hairline flex flex-col items-center gap-3" style={{ borderWidth: "0.5px" }}>
                <Loader2 className="h-5 w-5 animate-spin" />
                A IA está lendo seu PDF e extraindo os campos...
              </div>
            )}

            {isError && (
              <div className="text-center text-sm text-destructive py-8 bg-surface-1 rounded-xl border-hairline" style={{ borderWidth: "0.5px" }}>
                Falha ao processar o PDF. Tente reenviar ou envie outro arquivo.
              </div>
            )}

            {displayedSections.map((section, sIdx) => (
              <section key={section.id} className="bg-surface-1 rounded-xl border-hairline overflow-hidden" style={{ borderWidth: "0.5px" }}>
                <header className="px-5 py-3 border-b-hairline flex items-center justify-between">
                  <h3 className="font-display font-semibold text-sm tracking-tight">{section.title}</h3>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{section.kind === "table" ? "Tabela" : "Campos"}</span>
                </header>

                {section.kind === "fields" && section.fields && (
                  <div className="divide-y divide-border" style={{ borderColor: "var(--border)" }}>
                    {section.fields.map((f, fIdx) => (
                      <div
                        key={f.key}
                        className={cn(
                          "px-5 py-3 grid grid-cols-[140px_1fr] gap-4 items-start transition-colors rounded-sm",
                          flashedKeys.has(f.key) && "animate-field-flash",
                        )}
                      >
                        <span className="text-xs text-muted-foreground pt-2">{f.label}</span>
                        <EditableValue
                          value={f.value}
                          onChange={(v) => updateField(sIdx, fIdx, v)}
                          disabled={isProcessing}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {section.kind === "table" && section.table && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground bg-surface-2/40">
                          {section.table.columns.map((c) => (
                            <th key={c} className="px-5 py-2.5 font-medium">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.table.rows.map((row, i) => {
                          const rowKey = `${section.id}-r${i}`;
                          const hasFlash = Array.from(flashedKeys).some((k) => k.startsWith(rowKey));
                          return (
                            <tr
                              key={i}
                              className={cn(
                                "border-t-hairline transition-colors",
                                hasFlash && "animate-field-flash",
                              )}
                            >
                              {section.table!.columns.map((c) => (
                                <td key={c} className="px-3 py-1.5 text-sm">
                                  <EditableValue
                                    value={String(row[c] ?? "")}
                                    onChange={(v) => updateCell(sIdx, i, c, v)}
                                    disabled={isProcessing}
                                    compact
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ))}

            {!isProcessing && !isError && displayedSections.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-10 bg-surface-1 rounded-xl border-hairline" style={{ borderWidth: "0.5px" }}>
                Nenhum campo estruturado foi identificado neste PDF.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface EditableValueProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

function EditableValue({ value, onChange, disabled, compact }: EditableValueProps) {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setLocal(value);
  }, [value, focused]);

  return (
    <input
      type="text"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (local !== value) onChange(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setLocal(value); (e.target as HTMLInputElement).blur(); }
      }}
      disabled={disabled}
      className={cn(
        "w-full bg-transparent text-sm font-medium leading-relaxed break-words rounded px-2 py-1 transition-colors outline-none",
        "hover:bg-surface-2 focus:bg-surface-2 focus:ring-1 focus:ring-primary/60",
        compact && "text-sm px-2 py-0.5",
        disabled && "cursor-not-allowed opacity-60",
      )}
    />
  );
}
