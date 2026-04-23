import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Plan } from "@/types";

const FREE_LIMIT = 1;

export function useBilling() {
  const { user, profile } = useAuth();
  const [editsThisMonth, setEditsThisMonth] = useState(0);

  const refreshUsage = useCallback(async () => {
    if (!user) return;
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from("usage_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", start.toISOString());
    setEditsThisMonth(count ?? 0);
  }, [user]);

  useEffect(() => { refreshUsage(); }, [refreshUsage]);

  const plan: Plan = profile?.plan ?? "free";

  const canEdit = useMemo(() => {
    if (plan === "pro" || plan === "biz" || plan === "ppu") return true;
    return editsThisMonth < FREE_LIMIT;
  }, [plan, editsThisMonth]);

  // Billing disabled during beta. Plan upgrades will be re-enabled once the
  // Stripe webhook + server function for payment validation is implemented.
  const upgradePlan = useCallback(async (_next: Plan) => {
    throw new Error("Pagamentos em breve. O beta está liberado no plano Free.");
  }, []);

  const logEdit = useCallback(
    async (params: {
      documentId?: string;
      prompt: string;
      model: string;
      tokens_input: number;
      tokens_output: number;
      cost_usd: number;
    }) => {
      if (!user) return;
      await supabase.from("usage_logs").insert({
        user_id: user.id,
        document_id: params.documentId ?? null,
        prompt: params.prompt,
        model: params.model,
        tokens_input: params.tokens_input,
        tokens_output: params.tokens_output,
        cost_usd: params.cost_usd,
      });
      await refreshUsage();
    },
    [user, refreshUsage],
  );

  return {
    plan,
    canEdit,
    editsThisMonth,
    freeLimit: FREE_LIMIT,
    upgradePlan,
    logEdit,
    refreshUsage,
  };
}
