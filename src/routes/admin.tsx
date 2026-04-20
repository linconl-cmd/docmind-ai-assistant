import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Users, DollarSign, FileEdit, Cpu, Play } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useAdmin, type TestPromptResult } from "@/hooks/useAdmin";

import { Logo } from "@/components/ui/Logo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";

import { formatBRL, formatDate, formatNumber, formatUSD, planLabel } from "@/lib/format";
import { PROMPT_PRESETS, SAMPLE_PDF_CONTEXT } from "@/lib/mocks";
import type { Plan } from "@/types";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

type Tab = "dashboard" | "clients" | "prompts";

function AdminPage() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const admin = useAdmin();
  const [tab, setTab] = useState<Tab>("dashboard");

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/login" });
    else if (profile && profile.role !== "admin") navigate({ to: "/editor" });
  }, [user, profile, loading, navigate]);

  if (loading || !user || !profile) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  }

  if (profile.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-surface-1 rounded-xl p-8 max-w-md text-center border-hairline" style={{ borderWidth: "0.5px" }}>
          <h1 className="font-display text-xl font-semibold">Acesso restrito</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Esta área é apenas para administradores. Para testar o painel admin, atualize seu papel
            na tabela <code className="text-primary">user_roles</code>.
          </p>
          <Link to="/editor" className="inline-block mt-4">
            <Button size="sm" variant="subtle">Voltar ao editor</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-hairline">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Logo size="sm" />
            <span className="text-xs text-muted-foreground">/ admin</span>
          </div>
          <Link to="/editor" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao editor
          </Link>
        </div>
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-1">
            {(["dashboard", "clients", "prompts"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "h-10 px-4 text-sm font-medium transition-all relative",
                  tab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "dashboard" ? "Dashboard" : t === "clients" ? "Clientes" : "Testar Prompts"}
                {tab === t && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary rounded-full" />}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {tab === "dashboard" && <DashboardTab admin={admin} />}
        {tab === "clients" && <ClientsTab admin={admin} />}
        {tab === "prompts" && <PromptsTab admin={admin} />}
      </main>
    </div>
  );
}

/* ----------------- DASHBOARD ----------------- */

function DashboardTab({ admin }: { admin: ReturnType<typeof useAdmin> }) {
  const { stats } = admin;
  const cards = [
    { label: "Usuários totais", value: formatNumber(stats.total_users), icon: <Users className="h-4 w-4" /> },
    { label: "Receita estimada", value: formatBRL(stats.estimated_revenue_brl), icon: <DollarSign className="h-4 w-4" /> },
    { label: "PDFs editados", value: formatNumber(stats.total_edits), icon: <FileEdit className="h-4 w-4" /> },
    { label: "Custo API", value: formatUSD(stats.total_cost_usd), icon: <Cpu className="h-4 w-4" /> },
  ];

  const totalPlans = Object.values(stats.plan_distribution).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-surface-1 rounded-xl p-5 border-hairline" style={{ borderWidth: "0.5px" }}>
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs uppercase tracking-wider">{c.label}</span>
              <span className="text-primary">{c.icon}</span>
            </div>
            <p className="text-2xl font-display font-bold mt-3">{c.value}</p>
          </div>
        ))}
      </div>

      <section className="bg-surface-1 rounded-xl p-6 border-hairline" style={{ borderWidth: "0.5px" }}>
        <h2 className="font-display font-semibold text-base mb-4">Distribuição de planos</h2>
        <div className="space-y-3">
          {(["free", "ppu", "pro", "biz"] as Plan[]).map((p) => {
            const count = stats.plan_distribution[p];
            const pct = (count / totalPlans) * 100;
            return (
              <div key={p}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <div className="flex items-center gap-2">
                    <Badge variant={p} dot>{planLabel[p]}</Badge>
                    <span className="text-muted-foreground">{formatNumber(count)} usuários</span>
                  </div>
                  <span className="text-muted-foreground">{pct.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      p === "free" && "bg-plan-free",
                      p === "ppu" && "bg-plan-ppu",
                      p === "pro" && "bg-plan-pro",
                      p === "biz" && "bg-plan-biz",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-surface-1 rounded-xl border-hairline overflow-hidden" style={{ borderWidth: "0.5px" }}>
        <div className="px-6 py-4 border-b-hairline">
          <h2 className="font-display font-semibold text-base">Últimas edições</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground bg-surface-2/40">
              <th className="px-6 py-2.5 font-medium">Usuário</th>
              <th className="px-6 py-2.5 font-medium">Arquivo</th>
              <th className="px-6 py-2.5 font-medium">Prompt</th>
              <th className="px-6 py-2.5 font-medium text-right">Custo</th>
            </tr>
          </thead>
          <tbody>
            {stats.recent_edits.map((e) => (
              <tr key={e.id} className="border-t-hairline">
                <td className="px-6 py-3 font-medium">{e.user_name}</td>
                <td className="px-6 py-3 text-muted-foreground">{e.filename}</td>
                <td className="px-6 py-3 text-muted-foreground italic">"{e.prompt}"</td>
                <td className="px-6 py-3 text-right tabular-nums">{formatUSD(e.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ----------------- CLIENTS ----------------- */

function ClientsTab({ admin }: { admin: ReturnType<typeof useAdmin> }) {
  return (
    <div className="bg-surface-1 rounded-xl border-hairline overflow-hidden" style={{ borderWidth: "0.5px" }}>
      <div className="px-6 py-4 border-b-hairline flex items-center justify-between">
        <h2 className="font-display font-semibold text-base">Todos os clientes</h2>
        <span className="text-xs text-muted-foreground">{admin.clients.length} usuários</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground bg-surface-2/40">
            <th className="px-6 py-2.5 font-medium">Nome</th>
            <th className="px-6 py-2.5 font-medium">Email</th>
            <th className="px-6 py-2.5 font-medium">Plano</th>
            <th className="px-6 py-2.5 font-medium text-right">PDFs</th>
            <th className="px-6 py-2.5 font-medium text-right">Gasto</th>
            <th className="px-6 py-2.5 font-medium">Status</th>
            <th className="px-6 py-2.5 font-medium">Último acesso</th>
          </tr>
        </thead>
        <tbody>
          {admin.clients.map((c) => (
            <tr key={c.id} className="border-t-hairline hover:bg-surface-2/40 transition-colors">
              <td className="px-6 py-3 font-medium">{c.name}</td>
              <td className="px-6 py-3 text-muted-foreground">{c.email}</td>
              <td className="px-6 py-3"><Badge variant={c.plan} dot>{planLabel[c.plan]}</Badge></td>
              <td className="px-6 py-3 text-right tabular-nums">{formatNumber(c.total_pdfs)}</td>
              <td className="px-6 py-3 text-right tabular-nums">{formatBRL(c.spent_brl)}</td>
              <td className="px-6 py-3">
                <Badge variant={c.active ? "ok" : "neutral"} dot>{c.active ? "Ativo" : "Inativo"}</Badge>
              </td>
              <td className="px-6 py-3 text-muted-foreground text-xs">{formatDate(c.last_seen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------- PROMPTS ----------------- */

function PromptsTab({ admin }: { admin: ReturnType<typeof useAdmin> }) {
  const [systemPrompt, setSystemPrompt] = useState(PROMPT_PRESETS["Editor PDF"]);
  const [pdfContext, setPdfContext] = useState(SAMPLE_PDF_CONTEXT);
  const [userMessage, setUserMessage] = useState("Trocar a data de término para 01/08/2026");
  const [model, setModel] = useState("claude-haiku-4.5");
  const [last, setLast] = useState<TestPromptResult | null>(null);

  const run = async () => {
    const r = await admin.testPrompt({ systemPrompt, pdfContext, userMessage, model });
    setLast(r);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* LEFT */}
      <div className="space-y-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Presets</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(PROMPT_PRESETS).map((k) => (
              <button
                key={k}
                onClick={() => setSystemPrompt(PROMPT_PRESETS[k])}
                className="text-xs bg-surface-2 hover:bg-surface-3 px-2.5 py-1.5 rounded-md transition-colors border-hairline"
                style={{ borderWidth: "0.5px" }}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="sp">System prompt</Label>
          <Textarea id="sp" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={6} className="font-mono text-xs" />
        </div>

        <div>
          <Label htmlFor="ctx">Contexto do PDF</Label>
          <Textarea id="ctx" value={pdfContext} onChange={(e) => setPdfContext(e.target.value)} rows={6} className="font-mono text-xs" />
        </div>

        <div>
          <Label htmlFor="um">Mensagem do usuário</Label>
          <Textarea id="um" value={userMessage} onChange={(e) => setUserMessage(e.target.value)} rows={3} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="mod">Modelo</Label>
            <select
              id="mod"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-md bg-surface-1 px-3 py-2.5 text-sm border-hairline focus:outline-none focus:ring-2 focus:ring-ring"
              style={{ borderWidth: "0.5px" }}
            >
              <option value="claude-haiku-4.5">Claude Haiku 4.5</option>
              <option value="claude-sonnet-4.6">Claude Sonnet 4.6</option>
              <option value="claude-opus-4.6">Claude Opus 4.6</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button fullWidth loading={admin.running} onClick={run} leftIcon={<Play className="h-4 w-4" />}>
              Executar
            </Button>
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div className="space-y-4">
        <div>
          <Label>Resposta da API</Label>
          <pre className="bg-surface-1 rounded-md p-4 text-xs font-mono overflow-auto max-h-[180px] border-hairline whitespace-pre-wrap" style={{ borderWidth: "0.5px" }}>
            {last?.rawText ?? <span className="text-muted-foreground">Nenhuma execução ainda.</span>}
          </pre>
        </div>

        <div>
          <Label>JSON parseado</Label>
          <pre className="bg-primary-soft rounded-md p-4 text-xs font-mono overflow-auto max-h-[180px] border-hairline" style={{ borderWidth: "0.5px", borderColor: "rgb(124 109 255 / 0.4)" }}>
            {last ? JSON.stringify(last.parsed, null, 2) : <span className="text-muted-foreground">—</span>}
          </pre>
        </div>

        {last && (
          <div className="grid grid-cols-4 gap-2">
            {[
              { l: "Tempo", v: `${last.duration_ms} ms` },
              { l: "Tokens in", v: formatNumber(last.tokens_input) },
              { l: "Tokens out", v: formatNumber(last.tokens_output) },
              { l: "Custo", v: formatUSD(last.cost_usd) },
            ].map((m) => (
              <div key={m.l} className="bg-surface-1 rounded-md p-3 border-hairline" style={{ borderWidth: "0.5px" }}>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.l}</p>
                <p className="text-sm font-semibold mt-1 tabular-nums">{m.v}</p>
              </div>
            ))}
          </div>
        )}

        {admin.history.length > 0 && (
          <div>
            <Label>Histórico (últimas 8)</Label>
            <div className="bg-surface-1 rounded-md border-hairline divide-y divide-border" style={{ borderWidth: "0.5px" }}>
              {admin.history.map((h, i) => (
                <div key={i} className="px-3 py-2 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", h.ok ? "bg-success" : "bg-danger")} />
                    <span className="font-mono text-muted-foreground truncate">{h.model}</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground tabular-nums">
                    <span>{h.duration_ms} ms</span>
                    <span>{formatUSD(h.cost_usd)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
