# Mara PermuteAI

Assistente de prospecção WhatsApp para o PermuteAI.
Prospecta imobiliárias fundadoras e corretores embaixadores.

## Dois públicos, duas abordagens

### Imobiliárias Fundadoras (5 vagas)
- Tom: seletivo, exclusivo, urgência real
- Objetivo: agendar reunião presencial com o Dan
- Fluxo: msg1 → follow-up dia 3 → follow-up dia 7 → reunião

### Corretores Embaixadores (30 vagas)
- Tom: direto, focado em benefício financeiro
- Objetivo: cadastro direto na plataforma
- Fluxo: msg1 → follow-up dia 3 → follow-up dia 7 → cadastro

## Variáveis de ambiente (Railway)

| Variável | Descrição |
|---|---|
| SUPABASE_URL | https://ttkziejoitbrwoeqieph.supabase.co |
| SUPABASE_SERVICE_ROLE_KEY | Chave service role |
| ANTHROPIC_API_KEY | Chave Anthropic |
| EVOLUTION_API_URL | URL Evolution API |
| EVOLUTION_API_KEY | Chave Evolution |
| EVOLUTION_INSTANCE | MaraPermutai |
| DAN_PHONE | Número do Dan para notificações (ex: 5512988904030) |

## Endpoints

| Endpoint | Descrição |
|---|---|
| GET /health | Health check |
| POST /webhooks/evolution | Recebe mensagens WhatsApp |
| POST /disparar | Dispara msg para um lead (chamado pelo n8n) |
| POST /followups/processar | Processa follow-ups pendentes (chamado pelo n8n) |

## Integração com n8n

### Gerador de leads (Outscraper → Mara)
O n8n busca no Outscraper e chama o endpoint `/disparar`:

```json
POST https://mara-permutai.railway.app/disparar
{
  "telefone": "5512999999999",
  "nome": "Imobiliária Silva",
  "tipo": "imobiliaria",
  "cidade": "São José dos Campos",
  "corretores": "15"
}
```

Para corretores:
```json
{
  "telefone": "5512988888888",
  "nome": "João Corretor",
  "tipo": "corretor",
  "cidade": "Jacareí"
}
```

### Follow-ups automáticos
Criar um fluxo n8n que chama diariamente às 9h:
```
POST https://mara-permutai.railway.app/followups/processar
```

## Setup no Supabase
Rodar o arquivo `supabase_migration.sql` no SQL Editor do Supabase PermuteAI.
