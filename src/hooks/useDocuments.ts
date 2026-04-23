import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import { supabase } from "@/integrations/supabase/client";
import { uploadFileFn } from "@/server/upload-file";
import { extractDocumentFn } from "@/server/extract-document";
import type { AppDocument, DocSection } from "@/types";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const SELECTED_KEY = "docmind:selectedDocId";

export function useDocuments() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<AppDocument[]>([]);
  const [selectedId, setSelectedIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(SELECTED_KEY);
  });
  const [loading, setLoading] = useState(true);

  const setSelectedId = useCallback((val: string | null | ((curr: string | null) => string | null)) => {
    setSelectedIdState((curr) => {
      const next = typeof val === "function" ? val(curr) : val;
      if (typeof window !== "undefined") {
        if (next) window.localStorage.setItem(SELECTED_KEY, next);
        else window.localStorage.removeItem(SELECTED_KEY);
      }
      return next;
    });
  }, []);

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
      sections: (d.fields_detected as unknown as DocSection[] | null) ?? undefined,
    }));

    setDocuments(rows);
    setLoading(false);
    setSelectedId((curr) => {
      if (curr && rows.some((r) => r.id === curr)) return curr;
      return rows[0]?.id ?? null;
    });
  }, [user, setSelectedId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll while any doc is being extracted (handles tab close/refresh mid-extraction).
  useEffect(() => {
    const hasPending = documents.some((d) => d.status === "extracting" || d.status === "uploading");
    if (!hasPending) return;
    const timer = setInterval(() => refresh(), 4000);
    return () => clearInterval(timer);
  }, [documents, refresh]);

  const uploadDocument = useCallback(
    async (file: File) => {
      if (!user) return;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");

      const base64 = await fileToBase64(file);
      const authHeaders = { Authorization: `Bearer ${token}` };

      const { id } = await uploadFileFn({
        data: { filename: file.name, base64 },
        headers: authHeaders,
      });

      await refresh();
      setSelectedId(id);

      // Kick off extraction in background; refresh when done.
      extractDocumentFn({ data: { docId: id }, headers: authHeaders })
        .then(() => refresh())
        .catch(() => refresh());
    },
    [user, refresh, setSelectedId],
  );

  const selectDocument = useCallback((id: string) => setSelectedId(id), []);

  const deleteDocument = useCallback(
    async (id: string) => {
      const doc = documents.find((d) => d.id === id);
      if (!doc) return;
      if (doc.storage_path) {
        await supabase.storage.from("documents").remove([doc.storage_path]);
      }
      const { error } = await supabase.from("documents").delete().eq("id", id);
      if (error) throw error;
      setDocuments((docs) => docs.filter((d) => d.id !== id));
      setSelectedId((curr) => (curr === id ? null : curr));
    },
    [documents],
  );

  const updateDocumentSections = useCallback(
    (docId: string, updater: (doc: AppDocument) => AppDocument) => {
      setDocuments((docs) =>
        docs.map((d) => {
          if (d.id !== docId) return d;
          const updated = updater(d);
          if (updated.sections) {
            supabase
              .from("documents")
              .update({ fields_detected: updated.sections as never })
              .eq("id", docId)
              .then(() => undefined);
          }
          return updated;
        }),
      );
    },
    [],
  );

  const saveDocumentSections = useCallback(
    async (docId: string, sections: DocSection[]) => {
      const { error } = await supabase
        .from("documents")
        .update({ fields_detected: sections as never })
        .eq("id", docId);
      if (error) throw error;
      setDocuments((docs) =>
        docs.map((d) => (d.id === docId ? { ...d, sections, edit_count: d.edit_count + 1 } : d)),
      );
    },
    [],
  );

  const incrementEditCount = useCallback(
    async (docId: string) => {
      setDocuments((docs) =>
        docs.map((d) => (d.id === docId ? { ...d, edit_count: d.edit_count + 1 } : d)),
      );
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
    saveDocumentSections,
    incrementEditCount,
    refresh,
  };
}
