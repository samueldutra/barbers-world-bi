/**
 * Tenant (cliente) ativo. Um schema de dados por cliente no mesmo projeto Supabase; quem
 * decide o tenant é o SERVIDOR (cookie + associação em public.tenant_users, ver
 * `lib/tenant-server.ts`). O banco confere de novo em toda RPC (public.assert_tenant_access),
 * então um schema forjado no navegador só devolve erro.
 *
 * Este arquivo é seguro para componentes de cliente. No navegador o tenant ativo é entregue
 * pelo `TenantProvider` (layout da área logada) e lido pelos hooks via `tenantSchema()`.
 * Trocar de tenant recarrega a página, então não há dado do tenant anterior em memória.
 */

/** Aba de canal do Dashboard (ver public.tenants.config, sql/multi_tenant_config.sql). */
export interface AbaConfig {
  id: string
  label: string
  /** canais_venda.grupo do cliente. */
  grupo: string
  /** Ids de situacoes_pedido do cliente usados como padrão da aba. Ausente = padrão geral. */
  situacoes_padrao?: number[]
}

/** Configuração do dashboard que muda de cliente para cliente. */
export interface TenantConfig {
  abas?: AbaConfig[]
  /** Classificações de lead usadas pelo cliente, na ordem (catálogo em lib/leads-status.ts). */
  status_lead?: string[]
}

export interface Tenant {
  id: string
  slug: string
  nome: string
  schema_name: string
  /** Linha de public.bling_oauth deste cliente (null = usa o slug). */
  conta_bling: string | null
  logo_url: string | null
  is_admin: boolean
  config: TenantConfig
}

/** Cookie com o slug do tenant escolhido (validado no servidor a cada requisição). */
export const TENANT_COOKIE = 'tenant'

let tenantAtivo: Tenant | null = null

/** Chamado pelo TenantProvider antes dos filhos renderizarem. Só no navegador é lido. */
export function definirTenantAtivo(tenant: Tenant | null) {
  tenantAtivo = tenant
}

/** Schema do tenant ativo, para `p_schema_name`. Só chamar em efeitos e handlers no navegador. */
export function tenantSchema(): string {
  if (!tenantAtivo) throw new Error('Nenhum tenant ativo: TenantProvider ausente ou usuário sem tenant.')
  return tenantAtivo.schema_name
}
