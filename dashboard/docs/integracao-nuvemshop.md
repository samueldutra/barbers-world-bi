# Integração com a Nuvemshop — passo a passo

Módulo **Canais de Venda** (`/canais-venda`). Hoje ele **conecta** a loja (OAuth) e guarda o token com segurança;
a leitura de pedidos para o BI é a etapa seguinte (ver "Próximos passos").

## O que é preciso (resumo)

| Item | Quem / onde | Observação |
|---|---|---|
| App da Barbers World na Nuvemshop | Portal de Parceiros (criado **uma vez**) | Gera o **App ID** e o **Client Secret** |
| `NUVEMSHOP_APP_ID` | Vercel (Environment Variables) | Server-side |
| `NUVEMSHOP_CLIENT_SECRET` | Vercel (Environment Variables) | Segredo — nunca commitar |
| `NEXT_PUBLIC_APP_URL` | Vercel | `https://bw.findash.com.br` (sem barra no final) |
| Tabela `public.canais_integracoes` | SQL Editor do Supabase | Rodar `sql/create_table_canais_integracoes.sql` |
| Módulo **Canais de Venda** liberado | Tela de Usuários | Super admin já tem acesso |
| Acesso de administrador à loja | Quem for conectar | Entra na loja e clica em "Aceitar" |

## Parte 1 — Criar o app (uma única vez)

1. Crie uma conta em <https://partners.nuvemshop.com.br> (Portal de Parceiros) e vá em **Meus aplicativos → Criar aplicativo**.
2. Tipo: **aplicativo privado/customizado** para uso da própria loja (não precisa publicar na loja de apps).
3. **URL de redirecionamento (Redirect URI):**
   `https://bw.findash.com.br/api/canais-venda/nuvemshop/callback`
   (a tela de cadastro do canal mostra essa URL com botão de copiar; tem de ser **idêntica**).
4. **Permissões (scopes)** — marque, no mínimo, leitura de: **Pedidos (`read_orders`)**, **Produtos (`read_products`)**
   e **Clientes (`read_customers`)**. Só peça escrita se for atualizar algo na Nuvemshop.
5. Salve e copie o **App ID** e o **Client Secret** (aba de dados do app).

## Parte 2 — Configurar o servidor

1. Rode `sql/create_table_canais_integracoes.sql` no SQL Editor do Supabase.
2. Na Vercel (projeto `barbers-world-bi` → Settings → Environment Variables), crie:
   `NUVEMSHOP_APP_ID`, `NUVEMSHOP_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL`. Faça um redeploy.
   Localmente: copie para o `.env.local` (modelo em `.env.local.example`).
3. A tela de cadastro avisa com ⚠ qualquer variável que ainda falte.

## Parte 3 — Cadastrar o canal no BI

1. Entre em **Canais de Venda → Cadastrar canal → Nuvemshop**.
2. Dê um nome ao canal (ex.: "Nuvemshop — Loja Barbers World") e clique em **Conectar com a Nuvemshop**.
3. A Nuvemshop abre pedindo login na loja e a autorização do app → **Aceitar**.
4. Você volta ao BI com o canal **Conectado** (mostra nome e nº da loja). O token fica só no banco
   (`public.canais_integracoes`, acessível apenas por `service_role`) e **nunca** é enviado ao navegador.

Status: *Aguardando autorização* (cadastro criado, não aceitou ainda → botão **Autorizar**), *Conectado*, *Erro*
(mensagem no cartão → **Reconectar**).

## Como funciona por baixo

- `POST /api/canais-venda` cria o canal `pendente` com um `state` aleatório e devolve
  `https://www.nuvemshop.com.br/apps/{APP_ID}/authorize?state=...`.
- A Nuvemshop devolve o navegador para `/api/canais-venda/nuvemshop/callback?code=...&state=...`; a rota confere a
  sessão e o módulo, acha o canal pelo `state` (uso único), troca o `code` em
  `POST https://www.tiendanube.com/apps/authorize/token` e grava `access_token` + `user_id` (= ID da loja).
- O token da Nuvemshop **não expira** (só deixa de valer se o app for desinstalado). Chamadas à API:
  `https://api.nuvemshop.com.br/v1/{store_id}/...` com o header `Authentication: bearer <token>` e um `User-Agent`
  identificando o app (ver `src/lib/canais-integracao/nuvemshop.ts`).

## Próximos passos (não feitos ainda)

1. ETL de pedidos da Nuvemshop (`GET /v1/{store_id}/orders`, paginação `page`/`per_page`, filtro `updated_at_min`)
   → tabela própria no schema `barbers`; hoje o Bling já traz os pedidos da Nuvemshop, então decidir se o ETL novo
   complementa (frete, cupom, status de pagamento) ou substitui.
2. Webhooks (`order/created`, `order/updated`, `app/uninstalled`) para atualizar em tempo quase real.
3. Conciliar com `barbers.canais_venda` (grupo "Nuvemshop") para a aba do Dashboard.
