import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import type { AppDocument } from "@/types";

interface PDFViewerProps {
  doc: AppDocument | null;
  /** Set of recently edited field keys (highlight for 3s) */
  flashedKeys: Set<string>;
}

export function PDFViewer({ doc, flashedKeys }: PDFViewerProps) {
  const { show } = useToast();

  if (!doc) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Selecione ou faça upload de um documento.
      </div>
    );
  }

  const handleDownload = () => {
    show("PDF editado preparado para download (mock).", "success");
  };

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <div className="h-14 px-6 flex items-center justify-between border-b-hairline bg-surface-1">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{doc.filename}</span>
          <span className="text-xs text-muted-foreground shrink-0">· {doc.pages} páginas</span>
        </div>
        {doc.edit_count > 0 && (
          <Button size="sm" variant="primary" leftIcon={<Download className="h-4 w-4" />} onClick={handleDownload}>
            Baixar PDF editado
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-8 bg-background">
        <div className="max-w-2xl mx-auto space-y-6">
          {(doc.sections ?? []).map((section) => (
            <section key={section.id} className="bg-surface-1 rounded-xl border-hairline overflow-hidden" style={{ borderWidth: "0.5px" }}>
              <header className="px-5 py-3 border-b-hairline flex items-center justify-between">
                <h3 className="font-display font-semibold text-sm tracking-tight">{section.title}</h3>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{section.kind === "table" ? "Tabela" : "Campos"}</span>
              </header>

              {section.kind === "fields" && section.fields && (
                <div className="divide-y divide-border" style={{ borderColor: "var(--border)" }}>
                  {section.fields.map((f) => (
                    <div
                      key={f.key}
                      className={cn(
                        "px-5 py-3 grid grid-cols-[160px_1fr] gap-4 items-start transition-colors rounded-sm",
                        flashedKeys.has(f.key) && "animate-field-flash",
                      )}
                    >
                      <span className="text-xs text-muted-foreground pt-0.5">{f.label}</span>
                      <span className="text-sm font-medium leading-relaxed">{f.value}</span>
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
                        const isSenior = String(row["Descrição"] ?? "").toLowerCase().includes("sênior");
                        const isMensal = String(row["Descrição"] ?? "").toLowerCase().includes("mensalidade");
                        const flashSenior = isSenior && flashedKeys.has("table-valores-senior");
                        const flashMensal = isMensal && flashedKeys.has("table-valores-mensalidade");
                        return (
                          <tr
                            key={i}
                            className={cn(
                              "border-t-hairline transition-colors",
                              (flashSenior || flashMensal) && "animate-field-flash",
                            )}
                          >
                            {section.table!.columns.map((c) => (
                              <td key={c} className="px-5 py-2.5 text-sm">{row[c]}</td>
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

          {(!doc.sections || doc.sections.length === 0) && (
            <div className="text-center text-sm text-muted-foreground py-12 bg-surface-1 rounded-xl border-hairline" style={{ borderWidth: "0.5px" }}>
              Este documento ainda não foi processado pela IA. <br />
              Após upload real, os campos extraídos aparecerão aqui.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
