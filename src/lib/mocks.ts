import type { AppDocument, AdminClient, AdminEditLog, AdminStats } from "@/types";

export const SAMPLE_DOCUMENT: AppDocument = {
  id: "doc-sample-1",
  user_id: "local",
  filename: "Contrato_Prestacao_Servicos_Acme.pdf",
  storage_path: "",
  pages: 4,
  edit_count: 0,
  status: "ready",
  created_at: new Date().toISOString(),
  sections: [
    {
      id: "partes",
      title: "Partes",
      kind: "fields",
      fields: [
        { key: "f-contratante", label: "Contratante", value: "Acme Tecnologia Ltda. — CNPJ 12.345.678/0001-90" },
        { key: "f-contratada", label: "Contratada", value: "Mariana Costa ME — CNPJ 98.765.432/0001-10" },
        { key: "f-representante", label: "Representante legal", value: "João Pedro Almeida" },
      ],
    },
    {
      id: "vigencia",
      title: "Vigência",
      kind: "fields",
      fields: [
        { key: "f-inicio", label: "Data de início", value: "01/02/2025", type: "date" },
        { key: "f-termino", label: "Data de término", value: "01/02/2026", type: "date" },
        { key: "f-renovacao", label: "Renovação automática", value: "Não" },
      ],
    },
    {
      id: "valores",
      title: "Valores",
      kind: "table",
      table: {
        columns: ["Descrição", "Quantidade", "Valor unitário", "Total"],
        rows: [
          { Descrição: "Hora consultoria sênior", Quantidade: "40", "Valor unitário": "R$ 280,00", Total: "R$ 11.200,00" },
          { Descrição: "Hora consultoria pleno",  Quantidade: "60", "Valor unitário": "R$ 180,00", Total: "R$ 10.800,00" },
          { Descrição: "Mensalidade fixa",          Quantidade: "1",  "Valor unitário": "R$ 4.500,00", Total: "R$ 4.500,00" },
        ],
      },
    },
    {
      id: "condicoes",
      title: "Condições",
      kind: "fields",
      fields: [
        { key: "f-pagamento", label: "Forma de pagamento", value: "Boleto bancário, vencimento dia 10" },
        { key: "f-multa",     label: "Multa por atraso", value: "2% + juros 1% ao mês" },
        { key: "f-foro",      label: "Foro", value: "Comarca de São Paulo / SP" },
      ],
    },
  ],
};

export const ADMIN_CLIENTS_MOCK: AdminClient[] = [
  { id: "u1", name: "Mariana Costa", email: "mariana@costaadv.com", plan: "pro",  total_pdfs: 142, spent_brl: 49 * 6, active: true, last_seen: "2025-04-19T14:22:00Z" },
  { id: "u2", name: "Lucas Pereira", email: "lucas@stratlaw.com.br", plan: "biz",  total_pdfs: 318, spent_brl: 149 * 4, active: true, last_seen: "2025-04-20T09:11:00Z" },
  { id: "u3", name: "Camila Rocha",  email: "camila.rocha@gmail.com", plan: "ppu",  total_pdfs: 22,  spent_brl: 22 * 2.9, active: true, last_seen: "2025-04-18T20:50:00Z" },
  { id: "u4", name: "Renato Lima",   email: "rlima@imobsouza.com",   plan: "free", total_pdfs: 1,   spent_brl: 0,        active: true, last_seen: "2025-04-20T08:00:00Z" },
  { id: "u5", name: "Juliana Mendes",email: "ju.mendes@cooper.med.br", plan: "pro", total_pdfs: 78, spent_brl: 49 * 3, active: true, last_seen: "2025-04-19T16:40:00Z" },
  { id: "u6", name: "Felipe Andrade",email: "felipe@andradeconsult.com", plan: "ppu", total_pdfs: 8, spent_brl: 8 * 2.9, active: false, last_seen: "2025-03-02T12:00:00Z" },
  { id: "u7", name: "Patricia Souza",email: "patricia@souzaeadv.com.br", plan: "biz", total_pdfs: 412, spent_brl: 149 * 7, active: true, last_seen: "2025-04-20T11:05:00Z" },
  { id: "u8", name: "Gustavo Henrique",email:"gustavo.h@henriquebr.com", plan: "free", total_pdfs: 1, spent_brl: 0, active: false, last_seen: "2025-04-15T17:30:00Z" },
];

const RECENT_EDITS: AdminEditLog[] = [
  { id: "e1", user_name: "Patricia Souza", filename: "NDA_Vendor_2025.pdf",       prompt: "Trocar valor da multa para 5%",         cost_usd: 0.0042, created_at: "2025-04-20T11:05:00Z" },
  { id: "e2", user_name: "Lucas Pereira",  filename: "Contrato_Locacao.pdf",       prompt: "Mudar prazo para 24 meses",             cost_usd: 0.0061, created_at: "2025-04-20T10:48:00Z" },
  { id: "e3", user_name: "Mariana Costa",  filename: "Acordo_Honorarios.pdf",      prompt: "Atualizar dados do cliente",            cost_usd: 0.0038, created_at: "2025-04-20T10:21:00Z" },
  { id: "e4", user_name: "Juliana Mendes", filename: "Termo_Confidencialidade.pdf",prompt: "Adicionar cláusula de exclusividade",    cost_usd: 0.0089, created_at: "2025-04-20T09:55:00Z" },
  { id: "e5", user_name: "Camila Rocha",   filename: "Contrato_Servicos_TI.pdf",   prompt: "Trocar contratada para Camila Rocha ME", cost_usd: 0.0044, created_at: "2025-04-20T09:30:00Z" },
];

export const ADMIN_STATS_MOCK: AdminStats = {
  total_users: 1284,
  plan_distribution: { free: 812, ppu: 218, pro: 198, biz: 56 },
  total_edits: 18420,
  total_cost_usd: 142.38,
  estimated_revenue_brl: 198 * 49 + 56 * 149 + 218 * 2.9 * 4,
  recent_edits: RECENT_EDITS,
};

export const PROMPT_PRESETS: Record<string, string> = {
  "Editor PDF": `Você é um editor especializado em contratos jurídicos brasileiros.
Sua função é aplicar alterações solicitadas pelo usuário em campos extraídos de um PDF.
Sempre retorne JSON no formato:
{
  "alteracoes": [{ "campo": "id-do-campo", "valor_antigo": "...", "valor_novo": "..." }],
  "confirmacao": "frase explicando o que foi alterado"
}
Não invente campos. Não altere campos não mencionados.`,
  "Extrator de dados": `Você extrai dados estruturados de contratos.
Retorne JSON com partes, vigência, valores e condições. Use null para campos ausentes.`,
  "Revisor de contrato": `Você é um revisor de contratos. Aponte cláusulas ambíguas, riscos e sugestões de melhoria.
Responda em formato markdown com seções: Riscos / Sugestões / Pontos positivos.`,
};

export const SAMPLE_PDF_CONTEXT = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS

CONTRATANTE: Acme Tecnologia Ltda., inscrita no CNPJ sob nº 12.345.678/0001-90, com sede na Av. Paulista, 1000, São Paulo/SP.

CONTRATADA: Mariana Costa ME, inscrita no CNPJ sob nº 98.765.432/0001-10.

VIGÊNCIA: o presente contrato entra em vigor em 01/02/2025 e se encerra em 01/02/2026, sem renovação automática.

VALORES:
- Hora consultoria sênior: 40 x R$ 280,00 = R$ 11.200,00
- Hora consultoria pleno:  60 x R$ 180,00 = R$ 10.800,00
- Mensalidade fixa:        1  x R$ 4.500,00 = R$ 4.500,00

CONDIÇÕES: Pagamento por boleto bancário com vencimento todo dia 10. Multa de 2% e juros de 1% ao mês em caso de atraso. Foro da comarca de São Paulo/SP.`;

export const SAMPLE_API_RESPONSE_JSON = {
  alteracoes: [
    { campo: "f-termino", valor_antigo: "01/02/2026", valor_novo: "01/08/2026" },
  ],
  confirmacao: "A data de término do contrato foi alterada de 01/02/2026 para 01/08/2026.",
};
