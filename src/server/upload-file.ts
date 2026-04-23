import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

interface UploadRequest {
  filename: string;
  base64: string;
}

interface UploadResponse {
  id: string;
}

export const uploadFileFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: UploadRequest) => data)
  .handler(async ({ data, context }): Promise<UploadResponse> => {
    const { filename, base64 } = data;
    if (!base64) throw new Response("Arquivo ausente.", { status: 400 });

    const approxBytes = Math.floor((base64.length * 3) / 4);
    if (approxBytes > MAX_PDF_BYTES) {
      throw new Response("PDF excede o limite de 10MB no beta.", { status: 413 });
    }

    const userId = context.userId;
    const uuid = crypto.randomUUID();
    const storagePath = `${userId}/${uuid}.pdf`;

    let pdfBuffer: Uint8Array;
    try {
      pdfBuffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "base64 inválido";
      console.error("[upload-file] base64 decode failed:", msg);
      throw new Response(`Arquivo base64 inválido: ${msg}`, { status: 400 });
    }

    const { error: uploadErr } = await supabaseAdmin.storage
      .from("documents")
      .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: false });
    if (uploadErr) {
      console.error("[upload-file] storage upload failed:", uploadErr);
      throw new Response(`Erro no Storage: ${uploadErr.message}`, { status: 500 });
    }

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("documents")
      .insert({
        user_id: userId,
        filename,
        storage_path: storagePath,
        pages: 0,
        status: "extracting",
      })
      .select()
      .single();

    if (insertErr || !inserted) {
      console.error("[upload-file] DB insert failed:", insertErr);
      await supabaseAdmin.storage.from("documents").remove([storagePath]);
      throw new Response(`Erro no banco: ${insertErr?.message ?? "unknown"}`, { status: 500 });
    }

    return { id: inserted.id };
  });
