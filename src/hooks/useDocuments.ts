import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { AppDocument } from "@/types";
import { SAMPLE_DOCUMENT } from "@/lib/mocks";

/**
 * Local store: structured sections live only in app state (not yet persisted).
 * Document metadata (filename, pages, edit_count) IS persisted in Supabase.
 */
export function useDocuments() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<AppDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setDocuments([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("documents")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    const rows: AppDocument[] = (data ?? []).map((d) => ({
      id: d.id,
      user_id: d.user_id,
      filename: d.filename,
      storage_path: d.storage_path,
      pages: d.pages,
      extracted_text: d.extracted_text ?? undefined,
      claude_context: d.claude_context ?? undefined,
      edit_count: d.edit_count,
      status: d.status,
      created_at: d.created_at,
      // sections: only the sample doc has them by default
      sections: undefined,
    }));

    // Always include the sample document at the top for demo purposes
    const sample = { ...SAMPLE_DOCUMENT, user_id: user.id };
    setDocuments([sample, ...rows]);
    setLoading(false);
    setSelectedId((curr) => curr ?? sample.id);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const uploadDocument = useCallback(
    async (file: File) => {
      if (!user) return;
      // MOCK: insert metadata row, no real storage upload yet
      const { data, error } = await supabase
        .from("documents")
        .insert({
          user_id: user.id,
          filename: file.name,
          storage_path: `mock/${file.name}`,
          pages: Math.max(1, Math.round(file.size / 50_000)),
          status: "ready",
        })
        .select()
        .single();
      if (error) throw error;
      await refresh();
      setSelectedId(data.id);
    },
    [user, refresh],
  );

  const selectDocument = useCallback((id: string) => setSelectedId(id), []);

  const deleteDocument = useCallback(
    async (id: string) => {
      // Sample doc cannot be deleted (it's a local demo)
      if (id === SAMPLE_DOCUMENT.id) {
        throw new Error("O documento de exemplo não pode ser apagado.");
      }
      const { error } = await supabase.from("documents").delete().eq("id", id);
      if (error) throw error;
      setDocuments((docs) => docs.filter((d) => d.id !== id));
      setSelectedId((curr) => {
        if (curr !== id) return curr;
        // fall back to sample doc
        return SAMPLE_DOCUMENT.id;
      });
    },
    [],
  );

  const updateDocumentSections = useCallback(
    (docId: string, updater: (doc: AppDocument) => AppDocument) => {
      setDocuments((docs) => docs.map((d) => (d.id === docId ? updater(d) : d)));
    },
    [],
  );

  const incrementEditCount = useCallback(
    async (docId: string) => {
      setDocuments((docs) =>
        docs.map((d) => (d.id === docId ? { ...d, edit_count: d.edit_count + 1 } : d)),
      );
      // Persist if it's a real DB row (not the sample)
      if (docId === SAMPLE_DOCUMENT.id) return;
      const { data: doc } = await supabase
        .from("documents")
        .select("edit_count")
        .eq("id", docId)
        .single();
      if (doc) {
        await supabase
          .from("documents")
          .update({ edit_count: doc.edit_count + 1 })
          .eq("id", docId);
      }
    },
    [],
  );

  const selectedDocument = documents.find((d) => d.id === selectedId) ?? null;

  return {
    documents,
    loading,
    selectedDocument,
    selectDocument,
    uploadDocument,
    deleteDocument,
    updateDocumentSections,
    incrementEditCount,
    refresh,
  };
}
