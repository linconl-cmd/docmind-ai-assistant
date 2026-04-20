export const formatBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export const formatUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n < 1 ? 4 : 2,
    maximumFractionDigits: 4,
  }).format(n);

export const formatNumber = (n: number) =>
  new Intl.NumberFormat("pt-BR").format(n);

export const formatDate = (d: string | Date) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
    .format(typeof d === "string" ? new Date(d) : d);

export const formatTime = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(d);

export const planLabel: Record<string, string> = {
  free: "Free",
  ppu: "Pay per use",
  pro: "Pro",
  biz: "Business",
};

export const planPriceBRL: Record<string, string> = {
  free: "Grátis",
  ppu: "R$ 2,90 / PDF",
  pro: "R$ 49 / mês",
  biz: "R$ 149 / mês",
};
