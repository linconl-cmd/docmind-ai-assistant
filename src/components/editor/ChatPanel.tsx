import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Send, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { formatTime, formatUSD } from "@/lib/format";
import type { ChatMessage } from "@/types";

interface ChatPanelProps {
  messages: ChatMessage[];
  isTyping: boolean;
  suggestions: string[];
  onSend: (text: string) => void;
  model?: string;
}

export function ChatPanel({ messages, isTyping, suggestions, onSend, model = "claude-haiku-4.5" }: ChatPanelProps) {
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping]);

  const submit = () => {
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const showSuggestions = messages.filter((m) => m.role === "user").length === 0;

  return (
    <aside className="w-[360px] shrink-0 h-screen flex flex-col bg-surface-1 border-l-hairline">
      <header className="h-14 px-4 flex items-center justify-between border-b-hairline">
        <div className="flex items-center gap-2.5">
          <span
            className="h-8 w-8 rounded-md bg-primary/15 flex items-center justify-center text-primary font-display"
            style={{ borderWidth: "0.5px", borderStyle: "solid", borderColor: "rgb(124 109 255 / 0.4)" }}
          >
            ✦
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">DocMind IA</p>
            <p className="text-[10px] text-muted-foreground">{model}</p>
          </div>
        </div>
        <Badge variant="info" dot>online</Badge>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((m) => (
          <div key={m.id} className={cn("animate-fade-up flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-surface-2 text-foreground rounded-bl-sm border-hairline",
              )}
              style={m.role === "ai" ? { borderWidth: "0.5px" } : undefined}
            >
              {m.content}

              {m.edits && m.edits.length > 0 && (
                <ul className="mt-3 space-y-2 border-t-hairline pt-2.5">
                  {m.edits.map((e, i) => (
                    <li key={i} className="text-xs">
                      <p className="text-muted-foreground">{e.campo_label ?? e.campo}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="line-through text-muted-foreground/70 truncate max-w-[140px]">{e.valor_antigo}</span>
                        <span className="text-primary">→</span>
                        <span className="text-foreground font-medium truncate">{e.valor_novo}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1.5 px-1 flex items-center gap-2">
              <span>{formatTime(m.timestamp)}</span>
              {m.role === "ai" && m.tokens && (
                <>
                  <span>·</span>
                  <span>{m.tokens} tokens</span>
                  <span>·</span>
                  <span>{formatUSD(m.cost_usd ?? 0)}</span>
                </>
              )}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex items-center gap-2 animate-fade-in">
            <div className="bg-surface-2 rounded-2xl rounded-bl-sm px-4 py-3 border-hairline" style={{ borderWidth: "0.5px" }}>
              <span className="inline-flex items-center gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-muted-foreground"
                    style={{ animation: `typing-dot 1.4s ease-in-out ${i * 0.2}s infinite` }}
                  />
                ))}
              </span>
            </div>
          </div>
        )}

        {showSuggestions && (
          <div className="space-y-2 pt-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Sugestões para começar
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => onSend(s)}
                  className="text-xs bg-surface-2 hover:bg-surface-3 px-2.5 py-1.5 rounded-md transition-colors border-hairline text-left"
                  style={{ borderWidth: "0.5px" }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t-hairline">
        <div
          className="flex items-end gap-2 bg-surface-2 rounded-lg p-2 focus-within:ring-2 focus-within:ring-ring transition-all border-hairline"
          style={{ borderWidth: "0.5px" }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Diga o que alterar… (Enter envia)"
            className="flex-1 bg-transparent resize-none outline-none text-sm placeholder:text-muted-foreground/60 max-h-32 py-1 px-1"
            style={{ minHeight: 24 }}
          />
          <button
            onClick={submit}
            disabled={!text.trim() || isTyping}
            className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center hover:brightness-110 transition-all disabled:opacity-40 disabled:pointer-events-none shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
