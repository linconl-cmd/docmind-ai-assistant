import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useToast } from "@/components/ui/Toast";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { user, signIn, signUp, loading } = useAuth();
  const navigate = useNavigate();
  const { show } = useToast();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/editor" });
  }, [user, loading, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else {
        await signUp(email, password, name);
        show("Conta criada. Bem-vindo ao DocMind!", "success");
      }
      navigate({ to: "/editor" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro inesperado";
      const friendly = msg.includes("Invalid login credentials")
        ? "Email ou senha incorretos."
        : msg.includes("already registered")
          ? "Este email já tem uma conta. Tente fazer login."
          : msg;
      setError(friendly);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="px-6 py-5">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-8">
            <Logo size="lg" />
            <p className="mt-3 text-sm text-muted-foreground text-center">
              {mode === "signin" ? "Entre na sua conta para continuar" : "Crie sua conta gratuita"}
            </p>
          </div>

          <div className="bg-surface-1 rounded-xl p-6 border-hairline" style={{ borderWidth: "0.5px" }}>
            <div className="flex bg-surface-2 rounded-md p-0.5 mb-6 border-hairline" style={{ borderWidth: "0.5px" }}>
              {(["signin", "signup"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError(null); }}
                  className={`flex-1 h-8 rounded text-xs font-medium transition-all ${
                    mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "signin" ? "Entrar" : "Cadastrar"}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "signup" && (
                <div>
                  <Label htmlFor="name">Nome</Label>
                  <Input id="name" type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" />
                </div>
              )}
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" />
              </div>
              <div>
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
              </div>

              {error && (
                <div className="text-xs text-danger bg-danger/10 border-hairline border-danger/30 rounded-md px-3 py-2" style={{ borderWidth: "0.5px" }}>
                  {error}
                </div>
              )}

              <Button type="submit" fullWidth loading={submitting}>
                {mode === "signin" ? "Entrar" : "Criar conta"}
              </Button>
            </form>
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6">
            Ao continuar você concorda com os termos de uso do DocMind.
          </p>
        </div>
      </div>
    </div>
  );
}
