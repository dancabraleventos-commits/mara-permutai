-- ═══════════════════════════════════════
-- TABELA DE LEADS DA MARA
-- Cole no Supabase do PermuteAI → SQL Editor
-- ═══════════════════════════════════════

create table if not exists leads_prospeccao (
  id uuid primary key default uuid_generate_v4(),

  -- Dados do lead
  telefone text not null unique,
  nome text not null,
  tipo text not null, -- 'imobiliaria' ou 'corretor'
  cidade text,
  bairro text,
  corretores text, -- quantidade de corretores (para imobiliárias)
  site text,
  nota numeric,
  place_id text,

  -- Status do funil
  status text not null default 'novo',
  -- novo → msg1_enviada → respondeu → agendando_reuniao → convertido
  -- novo → msg1_enviada → followup1_enviado → ultimo_followup → sem_resposta
  -- sem_interesse

  -- Controle de envios
  tentativas integer not null default 0,
  respondeu boolean not null default false,
  respondeu_em timestamptz,
  proxima_tentativa timestamptz,

  -- Conversa
  historico jsonb not null default '[]',

  -- Metadados
  fonte text default 'outscraper',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index para busca rápida por telefone
create index if not exists leads_prospeccao_telefone_idx on leads_prospeccao(telefone);
create index if not exists leads_prospeccao_status_idx on leads_prospeccao(status);
create index if not exists leads_prospeccao_proxima_tentativa_idx on leads_prospeccao(proxima_tentativa);

-- Trigger updated_at
create trigger leads_prospeccao_updated_at
  before update on leads_prospeccao
  for each row execute function update_updated_at();
