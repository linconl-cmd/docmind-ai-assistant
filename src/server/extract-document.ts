import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { DocSection } from "@/types";

const MODEL = "claude-haiku-4-5";

interface ExtractRequest {
  docId: string;
}

interface ExtractResponse {
  status: "ready" | "error";
  sections: DocSection[];
  pages: number;
  error?: string;
}

const extractTool: Anthropic.Tool = {
  name: "store_document_structure",
  description: "Armazena a estrutura extraída de um contrato/documento jurídico.",
  input_schema: {
    type: "object",
    properties: {
      pages: { type: "number" },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            kind: { type: "string", enum: ["fields", "table"] },
            fields: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string" },
                  label: { type: "string" },
                  value: { type: "string" },
                  type: { type: "string", enum: ["text", "date", "currency", "number"] },
                },
                required: ["key", "label", "value"],
              },
            },
            table: {
              type: "object",
              properties: {
                columns: { type: "array", items: { type: "string" } },
                rows: { type: "array", items: { type: "object", additionalProperties: { type: "string" } } },
              },
              required: ["columns", "rows"],
            },
          },
          required: ["id", "title", "kind"],
        },
      },
    },
    required: ["pages", "sections"],
  },
};

export const extractDocumentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ExtractRequest) => data)
  .handler(async ({ data, context }): Promise<ExtractResponse> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Response("ANTHROPIC_API_KEY ausente.", { status: 500 });

    const { data: doc, error } = await supabaseAdmin
      .from("documents")
      .select("storage_path, user_id")
      .eq("id", data.docId)
      .maybeSingle();

    if (error || !doc) throw new Response("Documento não encontrado.", { status: 404 });
    if (doc.user_id !== context.userId) throw new Response("Acesso negado.", { status: 403 });

    const { data: file, error: dlErr } = await supabaseAdmin.storage
      .from("documents")
      .download(doc.storage_path);
    if (dlErr || !file) {
      console.error("[extract-document] download failed:", dlErr);
      throw new Response(`Falha ao baixar PDF: ${dlErr?.message}`, { status: 500 });
    }

    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    const anthropic = new Anthropic({ apiKey });

    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8192,
        tools: [extractTool],
        tool_choice: { type: "tool", name: "store_document_structure" },
        system: `Extrator de documentos brasileiros. Regras:
1. Primeira seção SEMPRE: id="cabecalho", title="Cabeçalho", kind="fields". Extraia do topo do PDF: título, ano, nome, CPF/CNPJ, órgão emissor. Preencha os valores reais do PDF.
2. Demais seções: extraia as principais (máx 10 seções). Use kind="table" para tabelas, kind="fields" para campos.
3. Valores: preencha "value" com o que está no PDF. Vazio se não preenchido. Nunca invente.
4. Seja CONCISO: máx 15 campos por seção de fields, máx 10 linhas por tabela.
5. Datas: dd/mm/aaaa. Valores: R$ X.XXX,XX.`,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
              { type: "text", text: "Extraia a estrutura deste documento usando a tool store_document_structure." },
            ],
          },
        ],
      });

      const toolBlock = response.content.find((b) => b.type === "tool_use");

      if (!toolBlock || toolBlock.type !== "tool_use") {
        const reason = response.stop_reason ?? "unknown";
        console.error("[extract-document] sem tool_use na resposta. stop_reason:", reason);
        throw new Error(`Extração incompleta (stop_reason: ${reason}). Tente reenviar o PDF.`);
      }

      const input = toolBlock.input as { pages: number; sections: DocSection[] };
      const sections: DocSection[] = input.sections ?? [];
      const pages: number = input.pages ?? 0;

      if (sections.length === 0) {
        console.error("[extract-document] Claude retornou seções vazias.");
        throw new Error("Claude não identificou seções no documento. Tente reenviar o PDF.");
      }

      await supabaseAdmin
        .from("documents")
        .update({
          status: "ready",
          pages,
          fields_detected: sections as unknown as never,
        })
        .eq("id", data.docId);

      return { status: "ready", sections, pages };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro na extração";
      console.error("[extract-document] Claude failed:", msg);
      await supabaseAdmin.from("documents").update({ status: "error" }).eq("id", data.docId);
      return { status: "error", sections: [], pages: 0, error: msg };
    }
  });
