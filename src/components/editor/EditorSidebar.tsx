import { useNavigate } from "@tanstack/react-router";
import { useRef, useState, type DragEvent } from "react";
import { Upload, FileText, LogOut, Trash2 } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { planLabel } from "@/lib/format";
import type { AppDocument, Plan } from "@/types";

interface EditorSidebarProps {
  documents: AppDocument[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpload: (file: File) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUpgrade: () => void;
  plan: Plan;
  isAdmin: boolean;
}

export function EditorSidebar({
  documents, selectedId, onSelect, onUpload, onDelete, onUpgrade, plan, isAdmin,
}: EditorSidebarProps) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const { show } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (file.type !== "application/pdf") {
      show("Apenas arquivos PDF são aceitos.", "error");
      return;
    }
    setUploading(true);
    try {
      await onUpload(file);
      show("Documento adicionado.", "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Erro no upload", "error");
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  const handleDelete = async (e: React.MouseEvent, doc: AppDocument) => {
    e.stopPropagation();
    const ok = window.confirm(`Apagar "${doc.filename}"? Esta ação não pode ser desfeita.`);
    if (!ok) return;
    try {
      await onDelete(doc.id);
      show("Documento apagado.", "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Erro ao apagar", "error");
    }
  };

  return (
    <aside className="w-[260px] shrink-0 h-screen flex flex-col bg-surface-1 border-r-hairline">
      <div className="px-4 h-14 flex items-center justify-between border-b-hairline">
        <Logo size="sm" />
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => navigate({ to: "/admin" })}
              className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors"
            >
              Admin
            </button>
          )}
          <ThemeToggle />
        </div>
      </div>

      <div className="p-4">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "rounded-lg p-4 text-center cursor-pointer transition-all border-hairline",
            dragOver ? "bg-primary/10 border-primary" : "bg-surface-2 hover:bg-surface-3",
          )}
          style={{ borderWidth: "0.5px", borderStyle: dragOver ? "solid" : "dashed" }}
        >
          <Upload className={cn("h-5 w-5 mx-auto mb-2", dragOver ? "text-primary" : "text-muted-foreground")} />
          <p className="text-xs font-medium">{uploading ? "Enviando…" : "Arraste seu PDF"}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">ou clique para escolher</p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>

      <div className="px-4 pb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Documentos</span>
        <span className="text-[10px] text-muted-foreground">{documents.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {documents.map((d) => {
          const active = d.id === selectedId;
          const isSample = d.id === "doc-sample-1";
          return (
            <div
              key={d.id}
              onClick={() => onSelect(d.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(d.id);
                }
              }}
              className={cn(
                "w-full text-left p-2.5 rounded-md mb-1 transition-all group cursor-pointer relative",
                active ? "bg-primary/10" : "hover:bg-surface-2",
              )}
              style={active ? { borderWidth: "0.5px", borderStyle: "solid", borderColor: "rgb(124 109 255 / 0.5)" } : undefined}
            >
              <div className="flex items-start gap-2">
                <FileText className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate pr-5">{d.filename}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-muted-foreground">{d.pages} pág.</span>
                    {d.edit_count > 0 && (
                      <span className="text-[10px] text-primary">· {d.edit_count} edição{d.edit_count > 1 ? "s" : ""}</span>
                    )}
                    {isSample && (
                      <span className="text-[10px] text-muted-foreground">· exemplo</span>
                    )}
                  </div>
                </div>
                {!isSample && (
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, d)}
                    aria-label={`Apagar ${d.filename}`}
                    className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-all"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-4 border-t-hairline space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Plano</p>
            <div className="mt-1">
              <Badge variant={plan} dot>{planLabel[plan]}</Badge>
            </div>
          </div>
          <Button size="sm" variant="subtle" onClick={onUpgrade}>
            Upgrade
          </Button>
        </div>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="truncate">Sair ({profile?.email})</span>
        </button>
      </div>
    </aside>
  );
}
