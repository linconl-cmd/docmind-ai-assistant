import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant =
  | "free" | "ppu" | "pro" | "biz"
  | "ok" | "warn" | "error" | "info" | "neutral";

interface BadgeProps {
  variant?: Variant;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}

const styles: Record<Variant, string> = {
  free:    "bg-plan-free/15 text-plan-free border-plan-free/30",
  ppu:     "bg-plan-ppu/15 text-plan-ppu border-plan-ppu/30",
  pro:     "bg-plan-pro/15 text-plan-pro border-plan-pro/40",
  biz:     "bg-plan-biz/15 text-plan-biz border-plan-biz/30",
  ok:      "bg-success/15 text-success border-success/30",
  warn:    "bg-warning/15 text-warning border-warning/30",
  error:   "bg-danger/15 text-danger border-danger/30",
  info:    "bg-primary/15 text-primary border-primary/30",
  neutral: "bg-surface-2 text-muted-foreground border-border",
};

const dotColors: Record<Variant, string> = {
  free: "bg-plan-free", ppu: "bg-plan-ppu", pro: "bg-plan-pro", biz: "bg-plan-biz",
  ok: "bg-success", warn: "bg-warning", error: "bg-danger",
  info: "bg-primary", neutral: "bg-muted-foreground",
};

export function Badge({ variant = "neutral", children, className, dot }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide",
        "border",
        styles[variant],
        className,
      )}
      style={{ borderWidth: "0.5px" }}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dotColors[variant])} />}
      {children}
    </span>
  );
}
