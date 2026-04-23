import { Modal } from "./Modal";
import { Button } from "./Button";
import { Check } from "lucide-react";
import type { Plan } from "@/types";
import { cn } from "@/lib/cn";

interface PlanUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (plan: Plan) => void;
  currentPlan?: Plan;
}

const plans: Array<{
  id: Plan;
  name: string;
  price: string;
  priceNote: string;
  highlight?: boolean;
  features: string[];
  cta: string;
}> = [
  {
    id: "ppu",
    name: "Pay per use",
    price: "R$ 2,90",
    priceNote: "por PDF editado",
    features: ["Sem assinatura", "Cobra apenas o que usar", "Histórico ilimitado"],
    cta: "Usar Pay per use",
  },
  {
    id: "pro",
    name: "Pro",
    price: "R$ 49",
    priceNote: "/mês",
    highlight: true,
    features: [
      "Edições ilimitadas",
      "Modelos premium (Sonnet)",
      "Histórico completo",
      "Suporte prioritário",
    ],
    cta: "Assinar Pro",
  },
  {
    id: "biz",
    name: "Business",
    price: "R$ 149",
    priceNote: "/mês — até 5 usuários",
    features: [
      "Tudo do Pro",
      "Até 5 usuários",
      "Painel administrativo",
      "Faturamento por NF",
    ],
    cta: "Assinar Business",
  },
];

export function PlanUpgradeModal({ isOpen, onClose, onSelect, currentPlan }: PlanUpgradeModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Planos pagos em breve"
      description="Estamos em beta gratuito para validar o produto. Os planos abaixo estarão disponíveis em breve — obrigado pela paciência!"
      size="xl"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
        {plans.map((p) => (
          <div
            key={p.id}
            className={cn(
              "rounded-xl bg-surface-2 p-5 flex flex-col relative transition-all",
              p.highlight ? "border-2 border-primary shadow-glow" : "border-hairline",
            )}
            style={!p.highlight ? { borderWidth: "0.5px" } : undefined}
          >
            {p.highlight && (
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold tracking-wider uppercase">
                Mais escolhido
              </span>
            )}
            <h3 className="font-display font-bold text-lg">{p.name}</h3>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-display font-bold">{p.price}</span>
              <span className="text-xs text-muted-foreground">{p.priceNote}</span>
            </div>
            <ul className="mt-4 space-y-2 flex-1">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span className="text-muted-foreground">{f}</span>
                </li>
              ))}
            </ul>
            <Button
              variant="subtle"
              fullWidth
              className="mt-5"
              onClick={() => onSelect(p.id)}
              disabled
            >
              {currentPlan === p.id ? "Plano atual" : "Em breve"}
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
