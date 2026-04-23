import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

interface Request {
  docId: string;
}

interface Response {
  url: string;
  filename: string;
}

export const getDocumentUrlFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: Request) => data)
  .handler(async ({ data, context }): Promise<Response> => {
    const { data: doc, error } = await supabaseAdmin
      .from("documents")
      .select("storage_path, filename, user_id")
      .eq("id", data.docId)
      .maybeSingle();

    if (error || !doc) throw new Response("Documento não encontrado.", { status: 404 });
    if (doc.user_id !== context.userId) throw new Response("Acesso negado.", { status: 403 });
    if (!doc.storage_path) throw new Response("Sem arquivo anexado.", { status: 404 });

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 60 * 60);
    if (signErr || !signed) throw new Response(`Erro ao gerar URL: ${signErr?.message}`, { status: 500 });

    return { url: signed.signedUrl, filename: doc.filename };
  });
