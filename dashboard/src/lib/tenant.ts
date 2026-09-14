/**
 * Schema Supabase do tenant atual. Fixo por enquanto — a Barbers World é o único
 * cliente deste frontend. Se um dia este BI atender mais de um tenant, trocar por um
 * valor vindo do contexto de autenticação (ex.: tabela public.tenants).
 */
export const TENANT_SCHEMA = 'barbers'
