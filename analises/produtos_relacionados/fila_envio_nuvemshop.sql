-- Fila, auditoria e exclusões do envio de produtos relacionados (complementares) à Nuvemshop.
-- A API (unstable PATCH /catalog/product/{id}) não permite ler as relações: a auditoria é a única fonte do que foi enviado.
-- Envio: ver enviar_relacionados.py. Desfazer um par: PATCH com {"complementary_products":[{"id":N,"@delete":true}]}.

create table if not exists barbers.nuvemshop_relacionados_envios (
  id bigserial primary key,
  id_produto_nuvem bigint not null,
  id_relacionado_nuvem bigint not null,
  tipo text not null default 'complementary',
  ordem int not null,
  acao text not null default 'upsert' check (acao in ('upsert','delete')),
  status text not null check (status in ('enviado','erro')),
  http_status int,
  resposta text,
  lote text,
  enviado_em timestamptz not null default now()
);
create index if not exists ix_nrel_env_prod on barbers.nuvemshop_relacionados_envios (id_produto_nuvem, id_relacionado_nuvem);
alter table barbers.nuvemshop_relacionados_envios enable row level security;

-- Produtos que NÃO recebem envio automático (ex.: relação manual feita no admin).
create table if not exists barbers.nuvemshop_relacionados_exclusoes (
  id_produto_nuvem bigint primary key,
  codigo text,
  motivo text not null,
  criado_em timestamptz not null default now()
);
alter table barbers.nuvemshop_relacionados_exclusoes enable row level security;

insert into barbers.nuvemshop_relacionados_exclusoes (id_produto_nuvem, codigo, motivo)
values (366673570, 'MDCCVLB02', 'Relação manual feita no admin; não sobrescrever')
on conflict do nothing;

-- Fila: pares (produto, relacionado) de barbers.produtos_relacionados mapeados para ids da Nuvemshop via SKU.
-- Filtros: sem kits; sugestões de marca/linha só com afinidade >= 0,3; sem produtos excluídos; ordem refeita sem buracos.
drop view if exists barbers.v_nuvemshop_relacionados_fila;
create view barbers.v_nuvemshop_relacionados_fila as
with base as (
  select distinct on (pn.id, rn.id)
    pn.id as id_produto_nuvem, r.codigo, r.nome,
    rn.id as id_relacionado_nuvem, r.codigo_relacionado, r.nome_relacionado,
    r.posicao, r.origem, r.afinidade
  from barbers.produtos_relacionados r
  join (select sku, min(id_produto) id from barbers.nuvemshop_produtos where coalesce(sku,'')<>'' group by sku) pn on pn.sku = r.codigo
  join (select sku, min(id_produto) id from barbers.nuvemshop_produtos where coalesce(sku,'')<>'' group by sku) rn on rn.sku = r.codigo_relacionado
  where pn.id <> rn.id
    and pn.id not in (select id_produto_nuvem from barbers.nuvemshop_relacionados_exclusoes)
    and r.nome_relacionado !~* '^kit'
    and (r.origem <> 'marca_linha' or r.afinidade >= 0.3)
  order by pn.id, rn.id, r.posicao
)
select id_produto_nuvem, codigo, nome, id_relacionado_nuvem, codigo_relacionado, nome_relacionado,
  (row_number() over (partition by id_produto_nuvem order by posicao))::int as ordem, origem, afinidade
from base;

revoke all on barbers.nuvemshop_relacionados_envios, barbers.nuvemshop_relacionados_exclusoes,
  barbers.v_nuvemshop_relacionados_fila from public, anon, authenticated;
