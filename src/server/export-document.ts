import { createServerFn } from "@tanstack/react-start";
import {
  PDFDocument, PDFRawStream, PDFName, PDFArray, PDFRef,
  PDFNumber, StandardFonts, rgb,
} from "pdf-lib";
import { inflateSync, deflateSync } from "node:zlib";
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
  method: "stream" | "overlay" | "original";
  replacedCount: number;
  notFound: string[];
  debug?: string;
}

// ---------------------------------------------------------------------------
// Build replacement map: original sections vs edited sections
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// PDF string helpers
// ---------------------------------------------------------------------------

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

function escapePdfChars(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function normalizeWS(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Stream text parser
// ---------------------------------------------------------------------------

interface TextItem {
  text: string;
  x: number;
  y: number;
  fontSize: number;
}

function parseTextFromStream(streamBytes: Buffer): TextItem[] {
  const text = streamBytes.toString("latin1");
  const items: TextItem[] = [];

  let inText = false;
  let fontSizeFromTf = 12;
  let fontSizeFromTm = 0;
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
      fontSizeFromTm = 0;
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

    const efs = () => fontSizeFromTm || fontSizeFromTf;

    switch (token) {
      case "Tf":
        if (stack.length >= 2) fontSizeFromTf = Math.abs(parseFloat(stack[stack.length - 1])) || 12;
        stack.length = 0;
        break;
      case "Tm": {
        if (stack.length >= 6) {
          const a = Math.abs(parseFloat(stack[stack.length - 6]));
          const d = Math.abs(parseFloat(stack[stack.length - 4]));
          const scaleY = d || a;
          if (scaleY > 1) fontSizeFromTm = scaleY;
          tmX = parseFloat(stack[stack.length - 2]) || 0;
          tmY = parseFloat(stack[stack.length - 1]) || 0;
        }
        stack.length = 0;
        break;
      }
      case "Td":
      case "TD":
        if (stack.length >= 2) {
          tmX += parseFloat(stack[stack.length - 2]) || 0;
          tmY += parseFloat(stack[stack.length - 1]) || 0;
        }
        stack.length = 0;
        break;
      case "T*":
        tmY -= efs() * 1.2;
        stack.length = 0;
        break;
      case "Tj": {
        if (stack.length >= 1) {
          const str = decodePdfString(stack[stack.length - 1]);
          if (str.trim()) items.push({ text: str, x: tmX, y: tmY, fontSize: efs() });
        }
        stack.length = 0;
        break;
      }
      case "TJ": {
        if (stack.length >= 1) {
          const str = extractStringsFromTJArray(stack[stack.length - 1]);
          if (str.trim()) items.push({ text: str, x: tmX, y: tmY, fontSize: efs() });
        }
        stack.length = 0;
        break;
      }
      case "'": {
        tmY -= efs() * 1.2;
        if (stack.length >= 1) {
          const str = decodePdfString(stack[stack.length - 1]);
          if (str.trim()) items.push({ text: str, x: tmX, y: tmY, fontSize: efs() });
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

// ---------------------------------------------------------------------------
// Stream reference — tracks mutable state for in-place replacement
// ---------------------------------------------------------------------------

interface StreamRef {
  pdfRef: PDFRef;
  obj: PDFRawStream;
  bytes: Buffer;
  compressed: boolean;
  dirty: boolean;
}

function collectStreams(pdfDoc: PDFDocument): StreamRef[] {
  const streams: StreamRef[] = [];
  for (const [ref, obj] of pdfDoc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const filter = obj.dict.get(PDFName.of("Filter"));
    const filterStr = filter?.toString() ?? "";
    const isFlate = filterStr.includes("FlateDecode");
    if (!isFlate && filter) continue;

    let decompressed: Buffer;
    try {
      decompressed = isFlate
        ? inflateSync(Buffer.from(obj.contents))
        : Buffer.from(obj.contents);
    } catch {
      continue;
    }

    if (!decompressed.toString("latin1").includes("BT")) continue;
    streams.push({
      pdfRef: ref as PDFRef,
      obj,
      bytes: decompressed,
      compressed: isFlate,
      dirty: false,
    });
  }
  return streams;
}

// ---------------------------------------------------------------------------
// Page ref mapping (handles Contents arrays)
// ---------------------------------------------------------------------------

function collectPageRefs(pdfDoc: PDFDocument): Map<string, number> {
  const map = new Map<string, number>();
  for (let pi = 0; pi < pdfDoc.getPageCount(); pi++) {
    const page = pdfDoc.getPage(pi);
    const raw = page.node.get(PDFName.of("Contents"));
    if (!raw) continue;
    if (raw instanceof PDFArray) {
      for (let i = 0; i < raw.size(); i++) {
        const item = raw.get(i);
        if (item instanceof PDFRef) map.set(item.toString(), pi);
      }
    } else if (raw instanceof PDFRef) {
      map.set(raw.toString(), pi);
    } else {
      map.set(raw.toString(), pi);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Direct stream replacement — replaces ALL occurrences across ALL streams
// ---------------------------------------------------------------------------

function tryStreamReplaceAll(
  streams: StreamRef[],
  oldText: string,
  newText: string,
): number {
  const escOld = escapePdfChars(oldText);
  const escNew = escapePdfChars(newText);

  // Regex with number boundaries to avoid corrupting partial matches
  // e.g. "6.000,00" must NOT match inside "16.000,00"
  const pattern = new RegExp(
    `(?<![0-9])${escapeRegex(escOld)}(?![0-9])`,
    "g",
  );

  let totalCount = 0;

  for (const stream of streams) {
    const content = stream.bytes.toString("latin1");
    const matches = content.match(pattern);
    if (!matches || matches.length === 0) continue;

    const modified = content.replace(pattern, escNew);
    stream.bytes = Buffer.from(modified, "latin1");
    stream.dirty = true;
    totalCount += matches.length;
  }

  return totalCount;
}

// ---------------------------------------------------------------------------
// Find text positions for overlay fallback (finds ALL occurrences)
// ---------------------------------------------------------------------------

interface FoundText {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

function findAllTextPositions(
  streams: StreamRef[],
  pageRefMap: Map<string, number>,
  searchText: string,
): FoundText[] {
  const results: FoundText[] = [];
  const normSearch = normalizeWS(searchText);

  for (const stream of streams) {
    const items = parseTextFromStream(stream.bytes);
    if (items.length === 0) continue;

    const pageIndex = pageRefMap.get(stream.pdfRef.toString()) ?? 0;

    // Group by Y into lines (tolerance ±3 units)
    const lineMap = new Map<number, { items: TextItem[]; text: string }>();
    for (const item of items) {
      const yKey = Math.round(item.y);
      let line: { items: TextItem[]; text: string } | undefined;
      for (const [k, v] of lineMap) {
        if (Math.abs(k - yKey) <= 3) { line = v; break; }
      }
      if (!line) {
        line = { items: [], text: "" };
        lineMap.set(yKey, line);
      }
      line.items.push(item);
      line.text += item.text;
    }

    const record = (item: TextItem, matchLen: number) => {
      results.push({
        pageIndex,
        x: item.x,
        y: item.y,
        width: matchLen * item.fontSize * 0.52,
        height: item.fontSize,
        fontSize: item.fontSize,
      });
    };

    // Check each item and line for ALL occurrences
    const foundYs = new Set<number>();

    // Single-item matches
    for (const item of items) {
      if (item.text.includes(searchText) || normalizeWS(item.text).includes(normSearch)) {
        if (!foundYs.has(Math.round(item.y))) {
          record(item, searchText.length);
          foundYs.add(Math.round(item.y));
        }
      }
    }

    // Line-level matches
    for (const [yKey, line] of lineMap) {
      if (foundYs.has(yKey)) continue;
      const lineText = line.text;
      const normLine = normalizeWS(lineText);
      if (lineText.includes(searchText) || normLine.includes(normSearch)) {
        const idx = lineText.indexOf(searchText);
        const useIdx = idx !== -1 ? idx : 0;
        let cc = 0;
        let mi = line.items[0];
        for (const it of line.items) {
          if (cc + it.text.length > useIdx) { mi = it; break; }
          cc += it.text.length;
        }
        record(mi, searchText.length);
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Flush modified streams back into the PDF document
// ---------------------------------------------------------------------------

function flushStreams(pdfDoc: PDFDocument, streams: StreamRef[]) {
  for (const s of streams) {
    if (!s.dirty) continue;
    const finalBytes = s.compressed ? deflateSync(s.bytes) : s.bytes;
    const newContents = new Uint8Array(finalBytes);
    s.obj.dict.set(PDFName.of("Length"), PDFNumber.of(newContents.length));
    const newStream = PDFRawStream.of(s.obj.dict, newContents);
    pdfDoc.context.assign(s.pdfRef, newStream);
  }
}

// ---------------------------------------------------------------------------
// Export endpoint
// ---------------------------------------------------------------------------

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
        try { originalSections = JSON.parse(doc.claude_context); } catch {}
      }

      const replacements = buildReplacements(originalSections, data.sections);
      console.log(`[export] ${replacements.size} replacement(s)`);

      if (replacements.size === 0) {
        return {
          base64: pdfBytes.toString("base64"),
          filename: exportName,
          method: "original",
          replacedCount: 0,
          notFound: [],
        };
      }

      const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const streams = collectStreams(pdfDoc);
      const pageRefMap = collectPageRefs(pdfDoc);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const notFound: string[] = [];
      let countStream = 0;
      let countOverlay = 0;
      const streamFailed: Array<[string, string]> = [];

      // ---- Phase 1: direct stream replacement (all occurrences) ----
      for (const [oldVal, newVal] of replacements) {
        const n = tryStreamReplaceAll(streams, oldVal, newVal);
        if (n > 0) {
          countStream += n;
          console.log(`[export] stream-replaced "${oldVal.slice(0, 40)}" → "${newVal.slice(0, 40)}" (${n}x)`);
        } else {
          streamFailed.push([oldVal, newVal]);
        }
      }

      // ---- Phase 2: overlay fallback for texts not found in streams ----
      for (const [oldVal, newVal] of streamFailed) {
        const positions = findAllTextPositions(streams, pageRefMap, oldVal);
        if (positions.length === 0) {
          notFound.push(oldVal.length > 50 ? oldVal.slice(0, 47) + "..." : oldVal);
          console.log(`[export] NOT FOUND: "${oldVal.slice(0, 80)}"`);
          continue;
        }

        for (const pos of positions) {
          const page = pdfDoc.getPage(pos.pageIndex);
          const fs = Math.max(6, Math.min(pos.fontSize, 20));

          const oldW = font.widthOfTextAtSize(oldVal, fs);
          let drawFs = fs;
          const newW = font.widthOfTextAtSize(newVal, drawFs);
          if (newW > oldW && oldW > 0) {
            const shrunk = Math.floor(fs * (oldW / newW));
            if (shrunk >= 5) drawFs = shrunk;
          }

          const coverW = Math.max(pos.width, oldW) + 2;

          page.drawRectangle({
            x: pos.x - 0.5,
            y: pos.y - pos.fontSize * 0.15,
            width: coverW,
            height: pos.fontSize * 0.95,
            color: rgb(1, 1, 1),
          });

          page.drawText(newVal, {
            x: pos.x,
            y: pos.y,
            size: drawFs,
            font,
            color: rgb(0, 0, 0),
          });

          countOverlay++;
        }
      }

      // ---- Phase 3: flush modified streams ----
      flushStreams(pdfDoc, streams);

      const resultBytes = Buffer.from(await pdfDoc.save());
      const total = countStream + countOverlay;

      return {
        base64: resultBytes.toString("base64"),
        filename: exportName,
        method: countStream > 0 ? "stream" : "overlay",
        replacedCount: total,
        notFound,
        debug: `stream=${countStream}|overlay=${countOverlay}|notFound=${notFound.length}|total=${replacements.size}`,
      };
    } catch (err) {
      console.error("[export] fatal error:", err);
      return {
        base64: "",
        filename: exportName,
        method: "original",
        replacedCount: 0,
        notFound: [],
        debug: `error: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  });
