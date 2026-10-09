#!/usr/bin/env bash
# Copia os segredos do ETL do .env local para os SEGREDOS DO REPOSITÓRIO no GitHub, que é onde o
# workflow .github/workflows/etl-hourly.yml os lê. Nunca imprime valores nem os passa como argumento
# de comando (vão por stdin, direto pro `gh`).
#
# Uso (na raiz do repositório):
#   bash scripts/mover-segredos-etl-github.sh [caminho/do/.env]     # padrão: etl-bling-pedidos-vendas/.env
#
# Antes de enviar, confere que SUPABASE_SERVICE_KEY é mesmo a chave com papel "service_role" (a
# "anon" faria as cargas do ETL falharem, desde que as funções do banco foram fechadas ao público).
set -euo pipefail

REPO="${REPO:-samueldutra/barbers-world-bi}"
ENV_FILE="${1:-etl-bling-pedidos-vendas/.env}"
OBRIGATORIOS=(SUPABASE_URL SUPABASE_SERVICE_KEY BLING_CLIENT_ID BLING_CLIENT_SECRET BLING_REDIRECT_URI)
OPCIONAIS=(DISCORD_WEBHOOK_URL)

erro() { echo "ERRO: $*" >&2; exit 1; }

command -v gh >/dev/null 2>&1 || erro "GitHub CLI (gh) não encontrado. Instale (brew install gh) e rode 'gh auth login'."
gh auth status >/dev/null 2>&1 || erro "gh não está logado. Rode 'gh auth login'."
[ -f "$ENV_FILE" ] || erro "arquivo não encontrado: $ENV_FILE (rode da raiz do repositório ou passe o caminho)."

# Valor de uma variável do .env (sem aspas nas pontas).
ler() {
  grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"
}

faltando=()
for nome in "${OBRIGATORIOS[@]}"; do
  [ -n "$(ler "$nome")" ] || faltando+=("$nome")
done
[ ${#faltando[@]} -eq 0 ] || erro "faltam no $ENV_FILE: ${faltando[*]}"

# A chave de serviço tem que ter papel service_role (decodifica o JWT; não mostra a chave).
papel="$(ler SUPABASE_SERVICE_KEY | python3 -c '
import sys, base64, json
t = sys.stdin.read().strip().split(".")
try:
    p = t[1] + "=" * (-len(t[1]) % 4)
    print(json.loads(base64.urlsafe_b64decode(p)).get("role", ""))
except Exception:
    print("")
')"
[ "$papel" = "service_role" ] || erro "SUPABASE_SERVICE_KEY não é a chave service_role (papel encontrado: '${papel:-ilegível}'). Pegue a service_role em Supabase > Settings > API."

echo "Enviando segredos para $REPO (valores não são exibidos)..."
for nome in "${OBRIGATORIOS[@]}" "${OPCIONAIS[@]}"; do
  valor="$(ler "$nome")"
  if [ -z "$valor" ]; then
    echo "  - $nome: vazio no .env, pulado"
    continue
  fi
  printf '%s' "$valor" | gh secret set "$nome" --repo "$REPO" >/dev/null
  echo "  ✓ $nome"
done

echo
echo "Segredos do repositório agora:"
gh secret list --repo "$REPO"
