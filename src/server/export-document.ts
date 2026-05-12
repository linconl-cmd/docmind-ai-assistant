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

// --- Content stream parser to extract text with positions ---

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

function tokenize(stream: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const len = stream.length;

  while (i < len) {
    while (i < len && /\s/.test(stream[i])) i++;
    if (i >= len) break;

    const ch = stream[i];

    if (ch === "%") {
      while (i < len && stream[i] !== "\n" && stream[i] !== "\r") i++;
      continue;
    }

    if (ch === "(") {
      let depth = 1;
      let s = "(";
      i++;
      while (i < len && depth > 0) {
        if (stream[i] === "\\") {
          s += stream[i] + (stream[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (stream[i] === "(") depth++;
        if (stream[i] === ")") depth--;
        s += stream[i];
        i++;
      }
      tokens.push(s);
      continue;
    }

    if (ch === "<") {
      if (i + 1 < len && stream[i + 1] === "<") {
        tokens.push("<<");
        i += 2;
        continue;
      }
      let s = "<";
      i++;
      while (i < len && stream[i] !== ">") {
        s += stream[i];
        i++;
      }
      if (i < len) {
        s += ">";
        i++;
      }
      tokens.push(s);
      continue;
    }

    if (ch === ">") {
      if (i + 1 < len && stream[i + 1] === ">") {
        tokens.push(">>");
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (ch === "[") {
      let depth = 1;
      let s = "[";
      i++;
      while (i < len && depth > 0) {
        if (stream[i] === "\\") {
          s += stream[i] + (stream[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (stream[i] === "[") depth++;
        if (stream[i] === "]") depth--;
        s += stream[i];
        i++;
      }
      tokens.push(s);
      continue;
    }

    let s = "";
    while (i < len && !/[\s()[\]<>/%]/.test(stream[i])) {
      s += stream[i];
      i++;
    }
    if (s) tokens.push(s);
  }

  return tokens;
}

function parseTextItems(streamBytes: Buffer): TextItem[] {
  const text = streamBytes.toString("latin1");
  const tokens = tokenize(text);
  const items: TextItem[] = [];
  const stack: string[] = [];

  let inText = false;
  let fontSize = 12;
  let tmX = 0;
  let tmY = 0;

  for (const token of tokens) {
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
          tmX = parseFloat(stack[stack.length - 2]) || 0;
          tmY = parseFloat(stack[stack.length - 1]) || 0;
          const scaleY = parseFloat(stack[stack.length - 4]);
          if (scaleY && Math.abs(scaleY) > 1) fontSize = Math.abs(scaleY);
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
      case '"': {
        tmY -= fontSize * 1.2;
        if (stack.length >= 3) {
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

function findTextPositions(
  pdfDoc: PDFDocument,
  pdfBytes: Buffer,
  searchTexts: string[],
): Map<string, FoundText> {
  const results = new Map<string, FoundText>();
  const remaining = new Set(searchTexts);

  for (const [, obj] of pdfDoc.context.enumerateIndirectObjects()) {
    if (remaining.size === 0) break;
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

    const streamText = decompressed.toString("latin1");
    if (!streamText.includes("BT")) continue;

    // Find which page this stream belongs to
    let pageIndex = -1;
    for (let pi = 0; pi < pdfDoc.getPageCount(); pi++) {
      const page = pdfDoc.getPage(pi);
      const contentsRef = page.node.get(PDFName.of("Contents"));
      if (!contentsRef) continue;
      const contentsStr = contentsRef.toString();
      // Check if any ref matches
      for (const [ref, o] of pdfDoc.context.enumerateIndirectObjects()) {
        if (o === obj && contentsStr.includes(ref.toString())) {
          pageIndex = pi;
          break;
        }
      }
      if (pageIndex >= 0) break;
    }

    const items = parseTextItems(decompressed);
    if (items.length === 0) continue;

    for (const searchText of [...remaining]) {
      // Single item match
      for (const item of items) {
        if (item.text.includes(searchText)) {
          const approxWidth = searchText.length * item.fontSize * 0.5;
          results.set(searchText, {
            pageIndex: Math.max(0, pageIndex),
            x: item.x,
            y: item.y,
            width: approxWidth,
            height: item.fontSize,
          });
          remaining.delete(searchText);
          break;
        }
      }
      if (!remaining.has(searchText)) continue;

      // Multi-item match: concatenate items on similar Y position
      for (let i = 0; i < items.length; i++) {
        let concat = "";
        const first = items[i];
        for (let j = i; j < items.length; j++) {
          if (j > i && Math.abs(items[j].y - first.y) > 3) break;
          concat += items[j].text;
          if (concat.includes(searchText)) {
            const approxWidth = searchText.length * first.fontSize * 0.5;
            results.set(searchText, {
              pageIndex: Math.max(0, pageIndex),
              x: first.x,
              y: first.y,
              width: approxWidth,
              height: first.fontSize,
            });
            remaining.delete(searchText);
            break;
          }
        }
        if (!remaining.has(searchText)) break;
      }
    }
  }

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

    let originalSections: DocSection[] = [];
    if (doc.claude_context) {
      try {
        originalSections = JSON.parse(doc.claude_context);
      } catch {}
    }

    const replacements = buildReplacements(originalSections, data.sections);

    if (replacements.size === 0) {
      return {
        base64: pdfBytes.toString("base64"),
        filename: exportName,
        method: "original",
        replacedCount: 0,
      };
    }

    try {
      const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const positions = findTextPositions(pdfDoc, pdfBytes, [...replacements.keys()]);
      console.log(`[export] found ${positions.size}/${replacements.size} text positions`);

      let count = 0;
      for (const [oldVal, newVal] of replacements) {
        const pos = positions.get(oldVal);
        if (!pos) continue;

        const page = pdfDoc.getPage(pos.pageIndex);
        const fontSize = Math.max(7, Math.min(Math.round(pos.height * 0.85), 14));
        const newTextWidth = font.widthOfTextAtSize(newVal, fontSize);
        const coverWidth = Math.max(pos.width, newTextWidth) + 6;

        page.drawRectangle({
          x: pos.x - 1,
          y: pos.y - 2,
          width: coverWidth,
          height: pos.height + 4,
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
      console.error("[export] overlay failed, returning original:", err);
      return {
        base64: pdfBytes.toString("base64"),
        filename: exportName,
        method: "original",
        replacedCount: 0,
        debug: `error: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  });
