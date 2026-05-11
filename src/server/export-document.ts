import { createServerFn } from "@tanstack/react-start";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
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
  method: "recreated";
  replacedCount: number;
  debug?: string;
}

const MARGIN_LEFT = 70;
const MARGIN_RIGHT = 50;
const MARGIN_TOP = 60;
const MARGIN_BOTTOM = 60;
const LINE_HEIGHT = 14;
const FONT_SIZE = 10;
const FONT_SIZE_TITLE = 14;
const FONT_SIZE_SECTION = 12;
const FONT_SIZE_SMALL = 8;
const TABLE_CELL_PADDING = 6;
const TABLE_ROW_HEIGHT = 20;
const SECTION_GAP = 24;
const FIELD_LABEL_WIDTH = 160;

const COLOR_TEXT = rgb(0.12, 0.12, 0.12);
const COLOR_MUTED = rgb(0.4, 0.4, 0.4);
const COLOR_SECTION_BG = rgb(0.95, 0.95, 0.97);
const COLOR_TABLE_HEADER_BG = rgb(0.22, 0.27, 0.35);
const COLOR_TABLE_HEADER_TEXT = rgb(1, 1, 1);
const COLOR_TABLE_STRIPE = rgb(0.96, 0.97, 0.98);
const COLOR_LINE = rgb(0.85, 0.85, 0.85);

interface PageLayout {
  width: number;
  height: number;
}

interface RenderContext {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  layout: PageLayout;
  page: PDFPage;
  y: number;
  pageNum: number;
}

function contentWidth(layout: PageLayout): number {
  return layout.width - MARGIN_LEFT - MARGIN_RIGHT;
}

function newPage(ctx: RenderContext): void {
  ctx.pageNum++;
  ctx.page = ctx.doc.addPage([ctx.layout.width, ctx.layout.height]);
  ctx.y = ctx.layout.height - MARGIN_TOP;
}

function ensureSpace(ctx: RenderContext, needed: number): void {
  if (ctx.y - needed < MARGIN_BOTTOM) {
    drawFooter(ctx);
    newPage(ctx);
  }
}

function drawFooter(ctx: RenderContext): void {
  const text = `Página ${ctx.pageNum}`;
  const w = ctx.font.widthOfTextAtSize(text, FONT_SIZE_SMALL);
  ctx.page.drawText(text, {
    x: ctx.layout.width / 2 - w / 2,
    y: MARGIN_BOTTOM / 2 - 4,
    size: FONT_SIZE_SMALL,
    font: ctx.font,
    color: COLOR_MUTED,
  });
}

function truncateText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (!text) return "";
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && font.widthOfTextAtSize(t + "…", size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = font.widthOfTextAtSize(word, size) <= maxWidth
        ? word
        : truncateText(word, font, size, maxWidth);
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function sanitize(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function drawDocumentTitle(ctx: RenderContext, sections: DocSection[]): void {
  const header = sections.find((s) => s.id === "cabecalho");
  const titleField = header?.fields?.find(
    (f) => f.key.includes("titulo") || f.label.toLowerCase().includes("título") || f.label.toLowerCase().includes("tipo"),
  );
  const title = titleField?.value || header?.title || "Documento";

  const cw = contentWidth(ctx.layout);
  const lines = wrapText(sanitize(title.toUpperCase()), ctx.bold, FONT_SIZE_TITLE, cw);

  ensureSpace(ctx, lines.length * (FONT_SIZE_TITLE + 4) + 20);

  for (const line of lines) {
    const w = ctx.bold.widthOfTextAtSize(line, FONT_SIZE_TITLE);
    ctx.page.drawText(line, {
      x: ctx.layout.width / 2 - w / 2,
      y: ctx.y,
      size: FONT_SIZE_TITLE,
      font: ctx.bold,
      color: COLOR_TEXT,
    });
    ctx.y -= FONT_SIZE_TITLE + 4;
  }

  ctx.y -= 8;

  ctx.page.drawLine({
    start: { x: MARGIN_LEFT, y: ctx.y },
    end: { x: ctx.layout.width - MARGIN_RIGHT, y: ctx.y },
    thickness: 0.5,
    color: COLOR_LINE,
  });
  ctx.y -= SECTION_GAP;
}

function drawFieldsSection(ctx: RenderContext, section: DocSection): void {
  if (!section.fields || section.fields.length === 0) return;

  const cw = contentWidth(ctx.layout);
  const sectionHeaderH = FONT_SIZE_SECTION + 16;

  ensureSpace(ctx, sectionHeaderH + LINE_HEIGHT * 2);

  // Section header with background
  ctx.page.drawRectangle({
    x: MARGIN_LEFT,
    y: ctx.y - 4,
    width: cw,
    height: sectionHeaderH,
    color: COLOR_SECTION_BG,
  });
  ctx.page.drawText(sanitize(section.title), {
    x: MARGIN_LEFT + 10,
    y: ctx.y + 2,
    size: FONT_SIZE_SECTION,
    font: ctx.bold,
    color: COLOR_TEXT,
  });
  ctx.y -= sectionHeaderH + 6;

  const valueMaxWidth = cw - FIELD_LABEL_WIDTH - 20;

  for (const field of section.fields) {
    const valueLines = wrapText(sanitize(field.value || "—"), ctx.font, FONT_SIZE, valueMaxWidth);
    const rowH = Math.max(LINE_HEIGHT, valueLines.length * LINE_HEIGHT) + 4;

    ensureSpace(ctx, rowH);

    // Label
    const label = truncateText(sanitize(field.label), ctx.bold, FONT_SIZE, FIELD_LABEL_WIDTH - 10);
    ctx.page.drawText(label, {
      x: MARGIN_LEFT + 10,
      y: ctx.y,
      size: FONT_SIZE,
      font: ctx.bold,
      color: COLOR_MUTED,
    });

    // Value (may be multi-line)
    let valY = ctx.y;
    for (const line of valueLines) {
      ctx.page.drawText(line, {
        x: MARGIN_LEFT + FIELD_LABEL_WIDTH,
        y: valY,
        size: FONT_SIZE,
        font: ctx.font,
        color: COLOR_TEXT,
      });
      valY -= LINE_HEIGHT;
    }

    ctx.y -= rowH;

    // Separator line
    ctx.page.drawLine({
      start: { x: MARGIN_LEFT + 10, y: ctx.y + 2 },
      end: { x: MARGIN_LEFT + cw - 10, y: ctx.y + 2 },
      thickness: 0.3,
      color: COLOR_LINE,
    });
  }

  ctx.y -= SECTION_GAP;
}

function drawTableSection(ctx: RenderContext, section: DocSection): void {
  if (!section.table || section.table.columns.length === 0) return;

  const cw = contentWidth(ctx.layout);
  const cols = section.table.columns;
  const colWidth = cw / cols.length;
  const sectionHeaderH = FONT_SIZE_SECTION + 16;

  ensureSpace(ctx, sectionHeaderH + TABLE_ROW_HEIGHT * 2);

  // Section header
  ctx.page.drawRectangle({
    x: MARGIN_LEFT,
    y: ctx.y - 4,
    width: cw,
    height: sectionHeaderH,
    color: COLOR_SECTION_BG,
  });
  ctx.page.drawText(sanitize(section.title), {
    x: MARGIN_LEFT + 10,
    y: ctx.y + 2,
    size: FONT_SIZE_SECTION,
    font: ctx.bold,
    color: COLOR_TEXT,
  });
  ctx.y -= sectionHeaderH + 4;

  // Table header row
  ensureSpace(ctx, TABLE_ROW_HEIGHT);
  ctx.page.drawRectangle({
    x: MARGIN_LEFT,
    y: ctx.y - TABLE_ROW_HEIGHT + TABLE_CELL_PADDING,
    width: cw,
    height: TABLE_ROW_HEIGHT,
    color: COLOR_TABLE_HEADER_BG,
  });

  for (let ci = 0; ci < cols.length; ci++) {
    const headerText = truncateText(sanitize(cols[ci]), ctx.bold, FONT_SIZE_SMALL + 1, colWidth - TABLE_CELL_PADDING * 2);
    ctx.page.drawText(headerText, {
      x: MARGIN_LEFT + ci * colWidth + TABLE_CELL_PADDING,
      y: ctx.y - TABLE_ROW_HEIGHT + TABLE_CELL_PADDING + 4,
      size: FONT_SIZE_SMALL + 1,
      font: ctx.bold,
      color: COLOR_TABLE_HEADER_TEXT,
    });
  }
  ctx.y -= TABLE_ROW_HEIGHT;

  // Table data rows
  for (let ri = 0; ri < section.table.rows.length; ri++) {
    const row = section.table.rows[ri];
    ensureSpace(ctx, TABLE_ROW_HEIGHT);

    // Stripe alternating rows
    if (ri % 2 === 0) {
      ctx.page.drawRectangle({
        x: MARGIN_LEFT,
        y: ctx.y - TABLE_ROW_HEIGHT + TABLE_CELL_PADDING,
        width: cw,
        height: TABLE_ROW_HEIGHT,
        color: COLOR_TABLE_STRIPE,
      });
    }

    for (let ci = 0; ci < cols.length; ci++) {
      const cellVal = truncateText(sanitize(String(row[cols[ci]] ?? "")), ctx.font, FONT_SIZE, colWidth - TABLE_CELL_PADDING * 2);
      ctx.page.drawText(cellVal, {
        x: MARGIN_LEFT + ci * colWidth + TABLE_CELL_PADDING,
        y: ctx.y - TABLE_ROW_HEIGHT + TABLE_CELL_PADDING + 4,
        size: FONT_SIZE,
        font: ctx.font,
        color: COLOR_TEXT,
      });
    }

    // Row border
    ctx.page.drawLine({
      start: { x: MARGIN_LEFT, y: ctx.y - TABLE_ROW_HEIGHT + TABLE_CELL_PADDING },
      end: { x: MARGIN_LEFT + cw, y: ctx.y - TABLE_ROW_HEIGHT + TABLE_CELL_PADDING },
      thickness: 0.3,
      color: COLOR_LINE,
    });

    ctx.y -= TABLE_ROW_HEIGHT;
  }

  ctx.y -= SECTION_GAP;
}

async function buildPdf(sections: DocSection[], layout: PageLayout): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ctx: RenderContext = {
    doc,
    font,
    bold,
    layout,
    page: null!,
    y: 0,
    pageNum: 0,
  };

  newPage(ctx);

  // Document title from header section
  drawDocumentTitle(ctx, sections);

  // Render each section
  for (const section of sections) {
    if (section.kind === "fields") {
      drawFieldsSection(ctx, section);
    } else if (section.kind === "table") {
      drawTableSection(ctx, section);
    }
  }

  // Footer on last page
  drawFooter(ctx);

  const bytes = await doc.save();
  return Buffer.from(bytes);
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

    // Read original PDF to get page dimensions and orientation
    let layout: PageLayout = { width: 595.28, height: 841.89 }; // A4 default

    try {
      const { data: file } = await supabaseAdmin.storage
        .from("documents")
        .download(doc.storage_path);

      if (file) {
        const origBuf = Buffer.from(await file.arrayBuffer());
        const origPdf = await PDFDocument.load(origBuf, { ignoreEncryption: true });
        if (origPdf.getPageCount() > 0) {
          const firstPage = origPdf.getPage(0);
          const { width, height } = firstPage.getSize();
          layout = { width, height };
        }
      }
    } catch (e) {
      console.log("[export] Could not read original PDF dimensions, using A4 default");
    }

    const exportName = doc.filename.replace(/\.pdf$/i, "") + "_editado.pdf";

    const pdfBytes = await buildPdf(data.sections, layout);
    const fieldCount = data.sections.reduce((acc, s) => {
      if (s.kind === "fields" && s.fields) return acc + s.fields.length;
      if (s.kind === "table" && s.table) return acc + s.table.rows.length * s.table.columns.length;
      return acc;
    }, 0);

    return {
      base64: pdfBytes.toString("base64"),
      filename: exportName,
      method: "recreated",
      replacedCount: fieldCount,
      debug: `layout=${layout.width.toFixed(0)}x${layout.height.toFixed(0)}|sections=${data.sections.length}|fields=${fieldCount}`,
    };
  });
