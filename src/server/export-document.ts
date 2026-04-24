import { createServerFn } from "@tanstack/react-start";
import { PDFDocument } from "pdf-lib";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { DocSection } from "@/types";

interface ExportRequest {
  docId: string;
  sections: DocSection[];
}

interface ExportResponse {
  base64: string;
  filename: string;
  hasAcroFields: boolean;
  filledCount: number;
}

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .trim();
}

function buildValueMap(sections: DocSection[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const section of sections) {
    if (section.kind === "fields" && section.fields) {
      for (const f of section.fields) {
        map.set(normalize(f.label), f.value);
        map.set(normalize(f.key), f.value);
      }
    }
  }
  return map;
}

function findValue(acroName: string, valueMap: Map<string, string>): string | null {
  const normAcro = normalize(acroName);
  // exact match
  if (valueMap.has(normAcro)) return valueMap.get(normAcro)!;
  // partial match: acro name contains field label or vice versa
  for (const [key, val] of valueMap) {
    if (normAcro.includes(key) || key.includes(normAcro)) return val;
  }
  return null;
}

export const exportDocumentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ExportRequest) => data)
  .handler(async ({ data, context }): Promise<ExportResponse> => {
    const { data: doc, error } = await supabaseAdmin
      .from("documents")
      .select("storage_path, user_id, filename")
      .eq("id", data.docId)
      .maybeSingle();

    if (error || !doc) throw new Response("Documento não encontrado.", { status: 404 });
    if (doc.user_id !== context.userId) throw new Response("Acesso negado.", { status: 403 });

    const { data: file, error: dlErr } = await supabaseAdmin.storage
      .from("documents")
      .download(doc.storage_path);

    if (dlErr || !file) throw new Response("Falha ao baixar PDF original.", { status: 500 });

    const buf = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true });

    const form = pdfDoc.getForm();
    const fields = form.getFields();
    const hasAcroFields = fields.length > 0;
    let filledCount = 0;

    if (hasAcroFields) {
      const valueMap = buildValueMap(data.sections);

      for (const field of fields) {
        const name = field.getName();
        const value = findValue(name, valueMap);
        if (!value) continue;

        try {
          const type = field.constructor.name;
          if (type === "PDFTextField") {
            (field as import("pdf-lib").PDFTextField).setText(value);
            filledCount++;
          } else if (type === "PDFCheckBox") {
            const lower = value.toLowerCase();
            if (lower === "sim" || lower === "true" || lower === "x" || lower === "1") {
              (field as import("pdf-lib").PDFCheckBox).check();
              filledCount++;
            }
          } else if (type === "PDFDropdown") {
            try {
              (field as import("pdf-lib").PDFDropdown).select(value);
              filledCount++;
            } catch { /* option not available */ }
          }
        } catch { /* field type mismatch — skip */ }
      }

      // Flatten so exported PDF shows values embedded (not as form fields)
      try { form.flatten(); } catch { /* some forms can't be flattened */ }
    }

    const pdfBytes = await pdfDoc.save();
    const binary = Array.from(pdfBytes).map((b) => String.fromCharCode(b)).join("");
    const base64 = btoa(binary);

    const exportName = doc.filename.replace(/\.pdf$/i, "") + "_editado.pdf";

    return { base64, filename: exportName, hasAcroFields, filledCount };
  });
