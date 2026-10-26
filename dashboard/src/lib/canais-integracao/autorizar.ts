import { autorizarModulo } from '@/lib/api/autorizar-modulo'

export const MODULO_CANAIS = 'canais-venda'

/** Usuário logado, ativo e com o módulo "Canais de venda" no tenant ativo (ou super admin). Devolve o tenant:
 * todo acesso a public.canais_integracoes (service_role) PRECISA filtrar por `tenant.id`. */
export function autorizarCanais() {
  return autorizarModulo(MODULO_CANAIS, 'Sem acesso ao módulo Canais de venda.')
}
