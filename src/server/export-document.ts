import { createServerFn } from "@tanstack/react-start";
import { PDFDocument, PDFRawStream, PDFName, PDFNumber, StandardFonts, rgb } from "pdf-lib";
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
  method: "acroform" | "stream" | "overlay" | "original";
  replacedCount: number;
  debug?: string;
}

function normalize(str: string): string {
  return str.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, " ").trim();
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
          const ev = String(e.table.rows[ri][col] ?? "").trim();
          if (ov && ev && ov !== ev) map.set(ov, ev);
        }
      }
    }
  }
  return map;
}

function replaceInBuffer(bytes: Buffer, replacements: Map<string, string>): { result: Buffer; count: number } {
  let text = bytes.toString("latin1");
  let count = 0;
  for (const [oldVal, newVal] of replacements) {
    if (oldVal.length < 2) continue;
    const escaped = oldVal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "g");
    const found = text.match(re);
    if (found) {
      const padded = newVal.length <= oldVal.length
        ? newVal + " ".repeat(oldVal.length - newVal.length)
        : newVal.slice(0, oldVal.length);
      text = text.replace(re, padded);
      count += found.length;
    }
  }
  return { result: Buffer.from(text, "latin1"), count };
}

function toUTF16BE(str: string): Buffer {
  const buf = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    buf.writeUInt16BE(str.charCodeAt(i), i * 2);
  }
  return buf;
}

function replaceUTF16InBuffer(bytes: Buffer, replacements: Map<string, string>): { result: Buffer; count: number } {
  let buf = Buffer.from(bytes);
  let count = 0;
  for (const [oldVal, newVal] of replacements) {
    if (oldVal.length < 2) continue;
    const oldBytes = toUTF16BE(oldVal);
    let offset = 0;
    while (offset < buf.length - oldBytes.length) {
      const idx = buf.indexOf(oldBytes, offset);
      if (idx === -1) break;
      const newBytes = toUTF16BE(
        newVal.length <= oldVal.length
          ? newVal + " ".repeat(oldVal.length - newVal.length)
          : newVal.slice(0, oldVal.length)
      );
      newBytes.copy(buf, idx);
      count++;
      offset = idx + newBytes.length;
    }
  }
  return { result: buf, count };
}

function extractTextStrings(stream: string): string[] {
  const strings: string[] = [];
  const re = /\(([^)]*(?:\\.[^)]*)*)\)/g;
  let m;
  while ((m = re.exec(stream)) !== null) {
    const raw = m[1]
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\")
      .replace(/\\(\d{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
    strings.push(raw);
  }
  return strings;
}

function replaceInTextOperators(streamBytes: Buffer, replacements: Map<string, string>): { result: Buffer; count: number } {
  let text = streamBytes.toString("latin1");
  let count = 0;

  for (const [oldVal, newVal] of replacements) {
    if (oldVal.length < 2) continue;

    const tjArrayRe = /\[([^\]]*)\]\s*TJ/gi;
    let match;
    while ((match = tjArrayRe.exec(text)) !== null) {
      const arrayContent = match[1];
      const extracted = extractTextStrings(arrayContent).join("");
      if (!extracted.includes(oldVal)) continue;

      const replaced = extracted.replace(oldVal,
        newVal.length <= oldVal.length
          ? newVal + " ".repeat(oldVal.length - newVal.length)
          : newVal.slice(0, oldVal.length)
      );
      const pdfEscaped = replaced.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      const newTj = `(${pdfEscaped}) Tj`;
      text = text.slice(0, match.index) + newTj + text.slice(match.index + match[0].length);
      count++;
      tjArrayRe.lastIndex = match.index + newTj.length;
    }
  }

  return { result: Buffer.from(text, "latin1"), count };
}

async function patchStreams(pdfBytes: Buffer, replacements: Map<string, string>): Promise<{ result: Buffer; count: number }> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  let totalCount = 0;

  for (const [ref, obj] of pdfDoc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;

    const dict = obj.dict;
    const filter = dict.get(PDFName.of("Filter"));
    const filterStr = filter?.toString() ?? "";
    const isFlate = filterStr.includes("FlateDecode") || filterStr.includes("/Fl");
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

    // 1. Try direct latin1 replacement
    let { result: patched, count } = replaceInBuffer(decompressed, replacements);

    // 2. Try UTF-16BE replacement (CID fonts)
    if (count === 0) {
      const utf16Result = replaceUTF16InBuffer(decompressed, replacements);
      if (utf16Result.count > 0) {
        patched = utf16Result.result;
        count = utf16Result.count;
      }
    }

    // 3. Try parsing TJ arrays (fragmented text)
    if (count === 0) {
      const tjResult = replaceInTextOperators(decompressed, replacements);
      if (tjResult.count > 0) {
        patched = tjResult.result;
        count = tjResult.count;
      }
    }

    if (count === 0) continue;
    totalCount += count;

    const newContent = isFlate ? deflateSync(patched) : patched;
    dict.set(PDFName.of("Length"), PDFNumber.of(newContent.length));
    pdfDoc.context.assign(ref, PDFRawStream.of(dict, newContent));
  }

  return { result: Buffer.from(await pdfDoc.save()), count: totalCount };
}

async function overlayEdits(
  pdfBytes: Buffer,
  original: DocSection[],
  edited: DocSection[],
): Promise<{ result: Buffer; count: number }> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageCount = pdfDoc.getPageCount();
  if (pageCount === 0) return { result: pdfBytes, count: 0 };

  const changes: Array<{ label: string; oldVal: string; newVal: string }> = [];
  for (let si = 0; si < Math.min(original.length, edited.length); si++) {
    const o = original[si];
    const e = edited[si];
    if (o.kind === "fields" && o.fields && e.fields) {
      for (let fi = 0; fi < Math.min(o.fields.length, e.fields.length); fi++) {
        const ov = o.fields[fi].value?.trim() ?? "";
        const ev = e.fields[fi].value?.trim() ?? "";
        if (ov && ev && ov !== ev) {
          changes.push({ label: o.fields[fi].label, oldVal: ov, newVal: ev });
        }
      }
    }
    if (o.kind === "table" && o.table && e.table) {
      for (let ri = 0; ri < Math.min(o.table.rows.length, e.table.rows.length); ri++) {
        for (const col of o.table.columns) {
          const ov = String(o.table.rows[ri][col] ?? "").trim();
          const ev = String(e.table.rows[ri][col] ?? "").trim();
          if (ov && ev && ov !== ev) {
            changes.push({ label: col, oldVal: ov, newVal: ev });
          }
        }
      }
    }
  }

  if (changes.length === 0) return { result: pdfBytes, count: 0 };

  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const fontSize = 10;
  const titleSize = 14;
  const lineHeight = fontSize * 1.6;
  let y = 841.89 - 60;

  page.drawText("Alterações Aplicadas ao Documento", {
    x: 50,
    y,
    size: titleSize,
    font: boldFont,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= titleSize + 10;

  page.drawText(`Total de alterações: ${changes.length}`, {
    x: 50,
    y,
    size: fontSize,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= lineHeight + 10;

  for (const change of changes) {
    if (y < 80) {
      const newPage = pdfDoc.addPage([595.28, 841.89]);
      y = 841.89 - 60;
      // Draw on newPage instead - use last page
    }

    page.drawText(`${change.label}:`, {
      x: 50,
      y,
      size: fontSize,
      font: boldFont,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= lineHeight;

    const deText = `De: ${change.oldVal}`;
    page.drawText(deText.length > 80 ? deText.slice(0, 80) + "…" : deText, {
      x: 70,
      y,
      size: fontSize - 1,
      font,
      color: rgb(0.6, 0.2, 0.2),
    });
    y -= lineHeight;

    const paraText = `Para: ${change.newVal}`;
    page.drawText(paraText.length > 80 ? paraText.slice(0, 80) + "…" : paraText, {
      x: 70,
      y,
      size: fontSize - 1,
      font,
      color: rgb(0.1, 0.5, 0.1),
    });
    y -= lineHeight + 8;
  }

  return { result: Buffer.from(await pdfDoc.save()), count: changes.length };
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

    if (error || !doc) throw new Response("Documento não encontrado.", { status: 404 });
    if (doc.user_id !== context.userId) throw new Response("Acesso negado.", { status: 403 });

    const { data: file, error: dlErr } = await supabaseAdmin.storage
      .from("documents")
      .download(doc.storage_path);
    if (dlErr || !file) throw new Response("Falha ao baixar PDF original.", { status: 500 });

    const buf = Buffer.from(await file.arrayBuffer());
    const exportName = doc.filename.replace(/\.pdf$/i, "") + "_editado.pdf";

    // --- 1. AcroForm ---
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
        let val = valueMap.get(n) ?? null;
        if (!val) {
          for (const [k, v] of valueMap) {
            if (k.length >= 3 && (n.includes(k) || k.includes(n))) { val = v; break; }
          }
        }
        if (!val) continue;
        try { form.getTextField(name).setText(val); filled++; continue; } catch {}
        try {
          if (["sim","true","x","1"].includes(val.toLowerCase())) { form.getCheckBox(name).check(); filled++; }
          continue;
        } catch {}
        try { form.getDropdown(name).select(val); filled++; } catch {}
      }
      try { form.flatten(); } catch {}
      const bytes = await pdfDoc.save();
      return { base64: Buffer.from(bytes).toString("base64"), filename: exportName, method: "acroform", replacedCount: filled };
    }

    // --- 2. Patch streams (latin1 + UTF-16BE + TJ arrays) ---
    let originalSections: DocSection[] = [];
    if (doc.claude_context) {
      try { originalSections = JSON.parse(doc.claude_context); } catch {}
    }

    const hasContext = originalSections.length > 0;
    const replacements = buildReplacements(originalSections, data.sections);
    const debugInfo = `ctx=${hasContext}|origSec=${originalSections.length}|editSec=${data.sections.length}|diffs=${replacements.size}`;
    console.log(`[export] ${debugInfo}`);

    if (replacements.size > 0) {
      console.log(`[export] replacements:`,
        [...replacements.entries()].map(([k, v]) => `"${k}" → "${v}"`).join(", "));

      const { result, count } = await patchStreams(buf, replacements);

      if (count > 0) {
        return { base64: result.toString("base64"), filename: exportName, method: "stream", replacedCount: count, debug: debugInfo };
      }

      // --- 3. Fallback: overlay page with changes ---
      console.log("[export] stream patching found 0 matches, falling back to overlay");
      const overlay = await overlayEdits(buf, originalSections, data.sections);
      if (overlay.count > 0) {
        return { base64: overlay.result.toString("base64"), filename: exportName, method: "overlay", replacedCount: overlay.count, debug: debugInfo };
      }
    }

    // --- 4. No changes ---
    return { base64: buf.toString("base64"), filename: exportName, method: "original", replacedCount: 0, debug: debugInfo };
  });
