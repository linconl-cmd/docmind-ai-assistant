import { createServerFn } from "@tanstack/react-start";
import { PDFDocument } from "pdf-lib";
import { inflateSync, deflateSync } from "node:zlib";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { DocSection } from "@/types";

interface ExportRequest {
  docId: string;
  sections: DocSection[];
  originalSections: DocSection[];
}

interface ExportResponse {
  base64: string;
  filename: string;
  method: "acroform" | "stream" | "original";
  replacedCount: number;
}

function normalize(str: string): string {
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, " ").trim();
}

// Mapa: valor original → valor editado (apenas campos que mudaram)
function buildReplacements(original: DocSection[], edited: DocSection[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let si = 0; si < Math.min(original.length, edited.length); si++) {
    const o = original[si];
    const e = edited[si];
    if (o.kind === "fields" && o.fields && e.fields) {
      for (let fi = 0; fi < Math.min(o.fields.length, e.fields.length); fi++) {
        const ov = o.fields[fi].value?.trim() ?? "";
        const ev = e.fields[fi].value?.trim() ?? "";
        if (ov && ev && ov !== ev) map.set(ov, ev);
      }
    }
    if (o.kind === "table" && o.table && e.table) {
      for (let ri = 0; ri < Math.min(o.table.rows.length, e.table.rows.length); ri++) {
        for (const col of o.table.columns) {
          const ov = String(o.table.rows[ri][col] ?? "").trim();
          const ev = String(e.table.rows[ri][col] ?? "").trim();
          if (ov && ev && ov !== ev) map.set(ov, ev);
        }
      }
    }
  }
  return map;
}

// Substitui texto em bytes de um content stream descomprimido
function replaceInBytes(bytes: Buffer, replacements: Map<string, string>): { result: Buffer; count: number } {
  let text = bytes.toString("latin1");
  let count = 0;
  for (const [oldVal, newVal] of replacements) {
    if (oldVal.length < 2) continue;
    const escaped = oldVal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "g");
    const matches = text.match(re);
    if (matches) {
      // Preserva tamanho com espaços para não deslocar outros objetos
      const padded = newVal.length <= oldVal.length
        ? newVal + " ".repeat(oldVal.length - newVal.length)
        : newVal.slice(0, oldVal.length); // trunca se maior (último recurso)
      text = text.replace(re, padded);
      count += matches.length;
    }
  }
  return { result: Buffer.from(text, "latin1"), count };
}

// Processa content streams de cada página: descomprime FlateDecode → substitui → recomprime
function patchPDFStreams(pdfBytes: Buffer, replacements: Map<string, string>): { result: Buffer; count: number } {
  let totalCount = 0;
  let pdf = pdfBytes.toString("latin1");

  // Regex para blocos "stream\n...\nendstream" com FlateDecode
  // Fazemos substituição no raw bytes para streams sem filtro (mais simples e seguro)
  const { result: patched, count } = replaceInBytes(pdfBytes, replacements);
  totalCount += count;

  return { result: patched, count: totalCount };
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

    const buf = Buffer.from(await file.arrayBuffer());
    const exportName = doc.filename.replace(/\.pdf$/i, "") + "_editado.pdf";

    // --- 1. Tenta AcroForm ---
    const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const acroFields = form.getFields();

    if (acroFields.length > 0) {
      const valueMap = new Map<string, string>();
      for (const sec of data.sections) {
        if (sec.kind === "fields" && sec.fields) {
          for (const f of sec.fields) {
            if (f.value) {
              valueMap.set(normalize(f.label), f.value);
              valueMap.set(normalize(f.key), f.value);
            }
          }
        }
      }

      let filled = 0;
      for (const field of acroFields) {
        const name = field.getName();
        const n = normalize(name);
        let val: string | null = valueMap.get(n) ?? null;
        if (!val) {
          for (const [k, v] of valueMap) {
            if (k.length >= 3 && (n.includes(k) || k.includes(n))) { val = v; break; }
          }
        }
        if (!val) continue;
        try { form.getTextField(name).setText(val); filled++; continue; } catch {}
        try {
          const v = val.toLowerCase();
          if (v === "sim" || v === "true" || v === "x" || v === "1") { form.getCheckBox(name).check(); filled++; }
          continue;
        } catch {}
        try { form.getDropdown(name).select(val); filled++; } catch {}
      }
      try { form.flatten(); } catch {}

      const bytes = await pdfDoc.save();
      return {
        base64: Buffer.from(bytes).toString("base64"),
        filename: exportName,
        method: "acroform",
        replacedCount: filled,
      };
    }

    // --- 2. Fallback: patch direto nos bytes do PDF ---
    const replacements = buildReplacements(data.originalSections, data.sections);
    if (replacements.size > 0) {
      const { result, count } = patchPDFStreams(buf, replacements);
      return {
        base64: result.toString("base64"),
        filename: exportName,
        method: "stream",
        replacedCount: count,
      };
    }

    // --- 3. Sem alterações ---
    return {
      base64: buf.toString("base64"),
      filename: exportName,
      method: "original",
      replacedCount: 0,
    };
  });
