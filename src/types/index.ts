export type Plan = "free" | "ppu" | "pro" | "biz";

export interface Profile {
  id: string;
  email: string;
  name: string;
  plan: Plan;
  role: "user" | "admin";
  created_at: string;
}

export interface DocField {
  key: string;
  label: string;
  value: string;
  type?: "text" | "date" | "currency" | "number";
}

export interface DocSection {
  id: string;
  title: string;
  kind: "fields" | "table";
  fields?: DocField[];
  table?: {
    columns: string[];
    rows: Array<Record<string, string>>;
  };
}

export interface AppDocument {
  id: string;
  user_id: string;
  filename: string;
  storage_path: string;
  pages: number;
  extracted_text?: string;
  fields_detected?: Record<string, string>;
  claude_context?: string;
  edit_count: number;
  status: "uploading" | "extracting" | "ready" | "error";
  created_at: string;
  /** Structured representation used by the viewer (mock-friendly). */
  sections?: DocSection[];
}

export interface EditChange {
  campo: string;
  campo_label?: string;
  valor_antigo: string;
  valor_novo: string;
}

export interface EditResult {
  alteracoes: EditChange[];
  confirmacao: string;
  tokens_input: number;
  tokens_output: number;
  cost_usd: number;
  model: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
  edits?: EditChange[];
  cost_usd?: number;
  tokens?: number;
  timestamp: Date;
}

export interface AdminClient {
  id: string;
  name: string;
  email: string;
  plan: Plan;
  total_pdfs: number;
  spent_brl: number;
  active: boolean;
  last_seen: string;
}

export interface AdminEditLog {
  id: string;
  user_name: string;
  filename: string;
  prompt: string;
  cost_usd: number;
  created_at: string;
}

export interface AdminStats {
  total_users: number;
  plan_distribution: Record<Plan, number>;
  total_edits: number;
  total_cost_usd: number;
  estimated_revenue_brl: number;
  recent_edits: AdminEditLog[];
}
