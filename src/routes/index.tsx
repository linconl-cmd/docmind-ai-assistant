import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { ArrowRight, Sparkles, Wand2, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate({ to: "/editor" });
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b-hairline">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Logo />
          <nav className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Entrar
            </Link>
            <Link to="/login">
              <Button size="sm" rightIcon={<ArrowRight className="h-4 w-4" />}>
                Começar grátis
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="max-w-6xl mx-auto px-6 pt-20 pb-24">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary text-xs px-3 py-1 border-hairline" style={{ borderColor: "rgb(124 109 255 / 0.4)" }}>
              <Sparkles className="h-3 w-3" /> Beta privado · Onboarding em 30 segundos
            </span>
            <h1 className="mt-6 text-5xl md:text-6xl font-display font-bold tracking-tight leading-[1.05]">
              Edite contratos e documentos
              <br />
              <span className="text-primary">em linguagem natural.</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground max-w-xl leading-relaxed">
              DocMind lê o PDF, identifica os campos importantes e aplica suas alterações
              em segundos. Sem template, sem mexer no Word, sem retrabalho.
            </p>
            <div className="mt-8 flex items-center gap-3">
              <Link to="/login">
                <Button size="lg" rightIcon={<ArrowRight className="h-4 w-4" />}>
                  Editar meu primeiro PDF
                </Button>
              </Link>
              <span className="text-xs text-muted-foreground">1 edição grátis · sem cartão</span>
            </div>
          </div>

          <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: <Wand2 className="h-5 w-5 text-primary" />, title: "Linguagem natural", body: "Diga “mudar prazo para 24 meses” e o DocMind aplica a alteração no campo certo." },
              { icon: <Sparkles className="h-5 w-5 text-primary" />, title: "Detecção automática", body: "A IA identifica partes, valores, datas e cláusulas — você não precisa configurar nada." },
              { icon: <ShieldCheck className="h-5 w-5 text-primary" />, title: "Auditoria de alterações", body: "Cada edição fica registrada com prompt, custo e modelo usado. Compliance pronto." },
            ].map((f) => (
              <div key={f.title} className="rounded-xl bg-surface-1 p-6 border-hairline" style={{ borderWidth: "0.5px" }}>
                <div className="h-9 w-9 rounded-md bg-primary/15 flex items-center justify-center">{f.icon}</div>
                <h3 className="mt-4 font-display font-semibold text-base">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t-hairline">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} DocMind</span>
          <span>Feito para quem vive de contratos.</span>
        </div>
      </footer>
    </div>
  );
}
