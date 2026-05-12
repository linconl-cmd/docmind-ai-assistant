import { createServerFn } from "@tanstack/react-start";
import { PDFDocument, PDFRawStream, PDFName, StandardFonts, rgb } from "pdf-lib";
import { inflateSync } from "node:zlib";
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

interface TextItem {
  text: string;
  x: number;
  y: number;
  fontSize: number;
}

function decodePdfString(raw: string): string {
  if (!raw.startsWith("(") || !raw.endsWith(")")) return "";
  const inner = raw.slice(1, -1);
  return inner
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\(\d{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

function extractStringsFromTJArray(raw: string): string {
  const parts: string[] = [];
  const re = /\(([^)]*(?:\\.[^)]*)*)\)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    parts.push(
      m[1]
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\")
        .replace(/\\(\d{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8))),
    );
  }
  return parts.join("");
}

function parseTextFromStream(streamBytes: Buffer): TextItem[] {
  const text = streamBytes.toString("latin1");
  const items: TextItem[] = [];

  let inText = false;
  let fontSize = 12;
  let tmX = 0;
  let tmY = 0;
  const stack: string[] = [];

  const re = /(\((?:[^()\\]|\\.)*\)|\[(?:[^\]\\]|\\.)*\]|<<|>>|[^\s()[\]<>/%]+|%[^\r\n]*)/g;
  let match;

  while ((match = re.exec(text)) !== null) {
    const token = match[1];

    if (token === "BT") {
      inText = true;
      tmX = 0;
      tmY = 0;
      stack.length = 0;
      continue;
    }
    if (token === "ET") {
      inText = false;
      stack.length = 0;
      continue;
    }
    if (!inText) {
      stack.length = 0;
      continue;
    }

    switch (token) {
      case "Tf":
        if (stack.length >= 2) fontSize = Math.abs(parseFloat(stack[stack.length - 1])) || 12;
        stack.length = 0;
        break;
      case "Tm":
        if (stack.length >= 6) {
          const d = parseFloat(stack[stack.length - 4]);
          if (d && Math.abs(d) > 1) fontSize = Math.abs(d);
          tmX = parseFloat(stack[stack.length - 2]) || 0;
          tmY = parseFloat(stack[stack.length - 1]) || 0;
        }
        stack.length = 0;
        break;
      case "Td":
      case "TD":
        if (stack.length >= 2) {
          tmX += parseFloat(stack[stack.length - 2]) || 0;
          tmY += parseFloat(stack[stack.length - 1]) || 0;
        }
        stack.length = 0;
        break;
      case "T*":
        tmY -= fontSize * 1.2;
        stack.length = 0;
        break;
      case "Tj": {
        if (stack.length >= 1) {
          const str = decodePdfString(stack[stack.length - 1]);
          if (str.trim()) items.push({ text: str, x: tmX, y: tmY, fontSize });
        }
        stack.length = 0;
        break;
      }
      case "TJ": {
        if (stack.length >= 1) {
          const str = extractStringsFromTJArray(stack[stack.length - 1]);
          if (str.trim()) items.push({ text: str, x: tmX, y: tmY, fontSize });
        }
        stack.length = 0;
        break;
      }
      case "'": {
        tmY -= fontSize * 1.2;
        if (stack.length >= 1) {
          const str = decodePdfString(stack[stack.length - 1]);
          if (str.trim()) items.push({ text: str, x: tmX, y: tmY, fontSize });
        }
        stack.length = 0;
        break;
      }
      default:
        stack.push(token);
        break;
    }
  }

  return items;
}

interface FoundText {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function findTextInStreams(
  pdfDoc: PDFDocument,
  searchTexts: string[],
): Map<string, FoundText> {
  const results = new Map<string, FoundText>();
  const remaining = new Set(searchTexts);

  // Collect all content streams with their decompressed bytes
  const streams: Array<{ obj: PDFRawStream; bytes: Buffer; refStr: string }> = [];

  for (const [ref, obj] of pdfDoc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    const filter = dict.get(PDFName.of("Filter"));
    const filterStr = filter?.toString() ?? "";
    const isFlate = filterStr.includes("FlateDecode");
    const noFilter = !filter;
    if (!isFlate && !noFilter) continue;

    let decompressed: Buffer;
    try {
      decompressed = isFlate
        ? inflateSync(Buffer.from(obj.contents))
        : Buffer.from(obj.contents);
    } catch {
      continue;
    }

    if (!decompressed.toString("latin1").includes("BT")) continue;
    streams.push({ obj, bytes: decompressed, refStr: ref.toString() });
  }

  // Build page → ref mapping once
  const pageRefMap = new Map<string, number>();
  for (let pi = 0; pi < pdfDoc.getPageCount(); pi++) {
    const page = pdfDoc.getPage(pi);
    const contentsRef = page.node.get(PDFName.of("Contents"));
    if (contentsRef) {
      const refStr = contentsRef.toString();
      // Store the ref string for this page
      pageRefMap.set(refStr, pi);
    }
  }

  for (const stream of streams) {
    if (remaining.size === 0) break;

    const items = parseTextFromStream(stream.bytes);
    if (items.length === 0) continue;

    // Find page index for this stream
    let pageIndex = 0;
    for (const [refStr, pi] of pageRefMap) {
      if (refStr.includes(stream.refStr)) {
        pageIndex = pi;
        break;
      }
    }

    // Build full line text for this stream (group by Y position)
    const lineMap = new Map<number, { items: TextItem[]; text: string }>();
    for (const item of items) {
      const yKey = Math.round(item.y);
      let line = lineMap.get(yKey);
      if (!line) {
        // Check nearby Y values (within 2 units)
        for (const [k, v] of lineMap) {
          if (Math.abs(k - yKey) <= 2) { line = v; break; }
        }
      }
      if (!line) {
        line = { items: [], text: "" };
        lineMap.set(yKey, line);
      }
      line.items.push(item);
      line.text += item.text;
    }

    for (const searchText of [...remaining]) {
      // Single item match
      for (const item of items) {
        if (item.text.includes(searchText)) {
          results.set(searchText, {
            pageIndex,
            x: item.x,
            y: item.y,
            width: searchText.length * item.fontSize * 0.52,
            height: item.fontSize,
          });
          remaining.delete(searchText);
          break;
        }
      }
      if (!remaining.has(searchText)) continue;

      // Line-level match (handles fragmented text like "R$" + " " + "1.000,00")
      for (const [, line] of lineMap) {
        const idx = line.text.indexOf(searchText);
        if (idx === -1) continue;

        // Find the item closest to where the match starts
        let charCount = 0;
        let matchItem = line.items[0];
        for (const item of line.items) {
          if (charCount + item.text.length > idx) {
            matchItem = item;
            break;
          }
          charCount += item.text.length;
        }

        results.set(searchText, {
          pageIndex,
          x: matchItem.x,
          y: matchItem.y,
          width: searchText.length * matchItem.fontSize * 0.52,
          height: matchItem.fontSize,
        });
        remaining.delete(searchText);
        break;
      }
    }
  }

  return results;
}

export const exportDocumentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ExportRequest) => data)
  .handler(async ({ data, context }): Promise<ExportResponse> => {
    let exportName = "documento_editado.pdf";

    try {
      const { data: doc, error } = await supabaseAdmin
        .from("documents")
        .select("storage_path, user_id, filename, claude_context")
        .eq("id", data.docId)
        .maybeSingle();

      if (error || !doc)
        throw new Error("Documento não encontrado.");
      if (doc.user_id !== context.userId)
        throw new Error("Acesso negado.");

      exportName = doc.filename.replace(/\.pdf$/i, "") + "_editado.pdf";

      const { data: file, error: dlErr } = await supabaseAdmin.storage
        .from("documents")
        .download(doc.storage_path);
      if (dlErr || !file)
        throw new Error("Falha ao baixar PDF original.");

      const pdfBytes = Buffer.from(await file.arrayBuffer());

      let originalSections: DocSection[] = [];
      if (doc.claude_context) {
        try {
          originalSections = JSON.parse(doc.claude_context);
        } catch {}
      }

      const replacements = buildReplacements(originalSections, data.sections);
      console.log(`[export] ${replacements.size} replacement(s)`);

      if (replacements.size === 0) {
        return {
          base64: pdfBytes.toString("base64"),
          filename: exportName,
          method: "original",
          replacedCount: 0,
        };
      }

      const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      let positions: Map<string, FoundText>;
      try {
        positions = findTextInStreams(pdfDoc, [...replacements.keys()]);
        console.log(`[export] found ${positions.size}/${replacements.size} positions`);
        // Log which replacements were NOT found
        for (const [oldVal] of replacements) {
          if (!positions.has(oldVal)) {
            console.log(`[export] NOT FOUND in PDF: "${oldVal.slice(0, 60)}"`);
          }
        }
      } catch (err) {
        console.error("[export] text search failed:", err);
        positions = new Map();
      }

      let count = 0;
      for (const [oldVal, newVal] of replacements) {
        const pos = positions.get(oldVal);
        if (!pos) continue;

        const page = pdfDoc.getPage(pos.pageIndex);
        const fontSize = Math.max(7, Math.min(Math.round(pos.height * 0.85), 14));

        // Cover only the old text width — don't extend beyond it
        const oldTextWidth = font.widthOfTextAtSize(oldVal, fontSize);
        const coverWidth = Math.max(pos.width, oldTextWidth) + 2;

        page.drawRectangle({
          x: pos.x - 0.5,
          y: pos.y - 1,
          width: coverWidth,
          height: pos.height + 2,
          color: rgb(1, 1, 1),
        });

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

      return {
        base64: resultBytes.toString("base64"),
        filename: exportName,
        method: "overlay",
        replacedCount: count,
        debug: `found=${positions.size}|applied=${count}|total=${replacements.size}`,
      };
    } catch (err) {
      console.error("[export] fatal error:", err);
      return {
        base64: "",
        filename: exportName,
        method: "original",
        replacedCount: 0,
        debug: `error: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  });
