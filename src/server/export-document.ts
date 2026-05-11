import { createServerFn } from "@tanstack/react-start";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getDocument, type TextItem as PdfjsTextItem } from "pdfjs-dist";
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
  method: "overlay" | "original";
  replacedCount: number;
  debug?: string;
}

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
          const ev = String(e.table.rows[ri]?.[col] ?? "").trim();
          if (ov && ev && ov !== ev) map.set(ov, ev);
        }
      }
    }
  }
  return map;
}

interface FoundText {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function findTextPositions(
  pdfBytes: Buffer,
  searchTexts: string[],
): Promise<Map<string, FoundText>> {
  const results = new Map<string, FoundText>();
  const remaining = new Set(searchTexts);

  const task = getDocument({
    data: new Uint8Array(pdfBytes),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
  });
  const doc = await task.promise;

  for (let pi = 0; pi < doc.numPages && remaining.size > 0; pi++) {
    const page = await doc.getPage(pi + 1);
    const tc = await page.getTextContent();
    const items = tc.items.filter(
      (it): it is PdfjsTextItem => "str" in it && it.str.length > 0,
    );

    for (const searchText of [...remaining]) {
      // 1) Single-item match
      for (const item of items) {
        if (item.str.includes(searchText)) {
          const t = item.transform;
          results.set(searchText, {
            pageIndex: pi,
            x: t[4],
            y: t[5],
            width: item.width,
            height: item.height || Math.abs(t[3]) || 12,
          });
          remaining.delete(searchText);
          break;
        }
      }
      if (!remaining.has(searchText)) continue;

      // 2) Multi-item match (text split across adjacent items on same line)
      for (let i = 0; i < items.length; i++) {
        let concat = "";
        const first = items[i];
        let endX = first.transform[4];

        for (let j = i; j < items.length; j++) {
          const cur = items[j];
          if (
            j > i &&
            Math.abs(cur.transform[5] - first.transform[5]) > 3
          )
            break;

          concat += cur.str;
          endX = cur.transform[4] + cur.width;

          if (concat.includes(searchText)) {
            results.set(searchText, {
              pageIndex: pi,
              x: first.transform[4],
              y: first.transform[5],
              width: endX - first.transform[4],
              height: first.height || Math.abs(first.transform[3]) || 12,
            });
            remaining.delete(searchText);
            break;
          }
        }
        if (!remaining.has(searchText)) break;
      }
    }
  }

  doc.destroy();
  return results;
}

export const exportDocumentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ExportRequest) => data)
  .handler(async ({ data, context }): Promise<ExportResponse> => {
    const { data: doc, error } = await supabaseAdmin
      .from("documents")
      .select("storage_path, user_id, filename, claude_context")
      .eq("id", data.docId)
      .maybeSingle();

    if (error || !doc)
      throw new Response("Documento não encontrado.", { status: 404 });
    if (doc.user_id !== context.userId)
      throw new Response("Acesso negado.", { status: 403 });

    const { data: file, error: dlErr } = await supabaseAdmin.storage
      .from("documents")
      .download(doc.storage_path);
    if (dlErr || !file)
      throw new Response("Falha ao baixar PDF original.", { status: 500 });

    const pdfBytes = Buffer.from(await file.arrayBuffer());
    const exportName = doc.filename.replace(/\.pdf$/i, "") + "_editado.pdf";

    // Build replacements from original (claude_context) vs edited sections
    let originalSections: DocSection[] = [];
    if (doc.claude_context) {
      try {
        originalSections = JSON.parse(doc.claude_context);
      } catch {}
    }

    const replacements = buildReplacements(originalSections, data.sections);
    console.log(
      `[export] ${replacements.size} replacement(s) to apply`,
    );

    if (replacements.size === 0) {
      return {
        base64: pdfBytes.toString("base64"),
        filename: exportName,
        method: "original",
        replacedCount: 0,
      };
    }

    // Find where old values appear in the original PDF
    let positions: Map<string, FoundText>;
    try {
      positions = await findTextPositions(pdfBytes, [
        ...replacements.keys(),
      ]);
    } catch (err) {
      console.error("[export] pdfjs text extraction failed:", err);
      positions = new Map();
    }

    console.log(
      `[export] found ${positions.size}/${replacements.size} text positions`,
    );

    // Load original PDF with pdf-lib and overlay changes
    const pdfDoc = await PDFDocument.load(pdfBytes, {
      ignoreEncryption: true,
    });
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    let count = 0;
    for (const [oldVal, newVal] of replacements) {
      const pos = positions.get(oldVal);
      if (!pos) continue;

      const page = pdfDoc.getPage(pos.pageIndex);
      const fontSize = Math.max(7, Math.min(Math.round(pos.height * 0.8), 14));

      // Estimate width needed for new text to size the white cover
      const newTextWidth = font.widthOfTextAtSize(newVal, fontSize);
      const coverWidth = Math.max(pos.width, newTextWidth) + 4;

      // White rectangle covers old text
      page.drawRectangle({
        x: pos.x - 1,
        y: pos.y - 2,
        width: coverWidth,
        height: pos.height + 4,
        color: rgb(1, 1, 1),
      });

      // Draw new text at same position
      page.drawText(newVal, {
        x: pos.x,
        y: pos.y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });

      count++;
    }

    const resultBytes = Buffer.from(await pdfDoc.save());
    const debug = `found=${positions.size}|applied=${count}|total=${replacements.size}`;
    console.log(`[export] done: ${debug}`);

    return {
      base64: resultBytes.toString("base64"),
      filename: exportName,
      method: "overlay",
      replacedCount: count,
      debug,
    };
  });
