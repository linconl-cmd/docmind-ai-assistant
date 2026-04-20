export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "text-base", md: "text-xl", lg: "text-3xl" };
  const dotSizes = { sm: "h-1.5 w-1.5", md: "h-2 w-2", lg: "h-3 w-3" };
  return (
    <div className="inline-flex items-center gap-2">
      <span
        className={`inline-flex items-center justify-center rounded-md bg-primary/15 ${
          size === "lg" ? "h-10 w-10" : size === "md" ? "h-7 w-7" : "h-6 w-6"
        }`}
        style={{ borderWidth: "0.5px", borderStyle: "solid", borderColor: "rgb(124 109 255 / 0.4)" }}
      >
        <span className={`rounded-full bg-primary ${dotSizes[size]}`} />
      </span>
      <span
        className={`font-display font-bold tracking-tight ${sizes[size]}`}
      >
        DocMind
      </span>
    </div>
  );
}
