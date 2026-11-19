-- Produtos relacionados (cross-sell) — máquinas de ACABAMENTO e SHAVER (regra 'acab_shaver_v1').
-- Mesma lógica de maquinas_corte.sql (v2), mas a "máquina de origem" é de acabamento ou shaver:
--  * origem 'marca_linha': produtos da mesma marca, 1 por tipo, afinidade (Jaccard) >= p_min_afinidade —
--    inclui a máquina de corte e a outra máquina (shaver<->acabamento) da mesma linha. Nunca o mesmo tipo da origem.
--  * origem 'historico': co-compra com as máquinas de acabamento/shaver nos últimos p_dias dias (lift >= 1,2,
--    máx. 2 por categoria). Máquinas (corte/acabamento/shaver) só entram por histórico se forem da mesma marca.
--  * Kits ficam de fora. Pedidos com mais de p_max_itens produtos distintos são ignorados.
-- Depende de barbers.tokens_produto/tipo_produto/jaccard e das colunas criadas em maquinas_corte.sql.
-- Recalcular: select * from barbers.recalcular_relacionados_acab_shaver(365);

create or replace function barbers.recalcular_relacionados_acab_shaver(
    p_dias int default 365,
    p_max_itens int default 15,
    p_k numeric default 15,
    p_min_afinidade numeric default 0.2,
    p_max_compat int default 4
) returns table(maquinas int, linhas int)
language plpgsql
security definer
set search_path = barbers, public
set statement_timeout = '300s'
as $$
declare
    v_ini date := current_date - p_dias;
    v_fim date := current_date;
begin
    create temp table t_cl on commit drop as
    with sit as (
        select id_situacao from barbers.situacoes_pedido
        where id_situacao not in (6, 12) and coalesce(id_herdado, 0) <> 6
    ),
    raw as (
        select pv.id_pedido, pv.id_produto, max(pv.descricao_item) d, avg(pv.valor_unitario_item) preco_item
        from barbers.pedidos_vendas pv
        join sit on sit.id_situacao = pv.id_situacao
        where pv.data >= v_ini and pv.data <= v_fim
          and pv.id_produto is not null and pv.id_produto <> 0
        group by pv.id_pedido, pv.id_produto
    ),
    ok as (select r.*, count(*) over (partition by r.id_pedido) n_itens from raw r)
    select id_pedido, id_produto, preco_item, barbers.tipo_produto(d) cat
    from ok where n_itens <= p_max_itens;
    create index on t_cl (id_pedido);
    create index on t_cl (id_produto);

    create temp table t_maq on commit drop as
    select distinct id_pedido, id_produto, cat from t_cl where cat in ('MAQ_ACABAMENTO', 'MAQ_SHAVER');
    create index on t_maq (id_pedido);

    create temp table t_pm on commit drop as select distinct id_pedido from t_maq;
    create index on t_pm (id_pedido);

    create temp table t_prod on commit drop as
    select p.id_produto, p.codigo, p.nome, p.preco,
           barbers.tipo_produto(p.nome) tipo,
           barbers.tokens_produto(p.nome) tokens,
           case when b.m in ('SEM MARCA','CAPA CORTE','ESPANADOR','BORRIFADOR','ESCOVINHA DEGRADE') then null else b.m end marca,
           coalesce(nv.pub, false) pub, coalesce(nv.est, 0) est
    from barbers.produtos p
    left join lateral (
        select bool_or(n.publicado) pub, max(coalesce(n.estoque, 0)) est, max(nullif(upper(trim(n.marca)), '')) marca
        from barbers.nuvemshop_produtos n where n.sku = p.codigo
    ) nv on true
    cross join lateral (select coalesce(nullif(upper(trim(p.marca)), ''), nv.marca) m) b
    where p.situacao = 'A';
    create index on t_prod (id_produto);

    create temp table t_mach on commit drop as
    select * from t_prod where tipo in ('MAQ_ACABAMENTO', 'MAQ_SHAVER') and pub;

    create temp table t_compat on commit drop as
    with c as (
        select m.id_produto id_m, c.id_produto id_c, c.tipo, c.preco, barbers.jaccard(m.tokens, c.tokens) j
        from t_mach m
        join t_prod c on c.marca = m.marca and c.id_produto <> m.id_produto
        where m.marca is not null and c.tipo <> m.tipo and c.tipo <> 'KIT'
          and c.pub and c.est > 0 and c.preco >= 10
    ),
    r as (
        select *, row_number() over (partition by id_m, tipo order by j desc, preco desc, id_c) rt
        from c where j >= p_min_afinidade
    )
    select id_m, id_c, tipo, preco, j,
           row_number() over (partition by id_m order by j desc, preco desc, id_c) pos
    from r where rt = 1;

    create temp table t_cand on commit drop as
    select c.id_produto, max(c.cat) cat, avg(c.preco_item) preco,
           count(distinct c.id_pedido)::numeric f,
           count(distinct c.id_pedido) filter (where pm.id_pedido is not null)::numeric cj
    from t_cl c
    left join t_pm pm on pm.id_pedido = c.id_pedido
    join t_prod p on p.id_produto = c.id_produto and p.pub and p.est > 0
    where c.cat <> 'KIT'
    group by c.id_produto
    having count(distinct c.id_pedido) filter (where pm.id_pedido is not null) >= 5
       and avg(c.preco_item) >= 10;

    create temp table t_sj on commit drop as
    select a.id_produto id_m, b.id_produto id_c, count(distinct a.id_pedido)::numeric sj
    from t_maq a join t_cl b on b.id_pedido = a.id_pedido and b.id_produto <> a.id_produto
    group by 1, 2;

    delete from barbers.produtos_relacionados where regra = 'acab_shaver_v1';

    insert into barbers.produtos_relacionados (
        id_produto, codigo, nome, posicao, id_produto_relacionado, codigo_relacionado, nome_relacionado,
        categoria_relacionado, preco_relacionado, pedidos_base, pedidos_juntos, prob_sku, prob_classe,
        prob_suavizada, lift, valor_esperado, regra, periodo_inicio, periodo_fim, origem, afinidade, marca)
    with tot as (select count(distinct id_pedido)::numeric n from t_cl),
    ncl as (select count(*)::numeric n from t_pm),
    nm as (select id_produto, count(distinct id_pedido)::numeric n from t_maq group by 1),
    comp as (
        select t.id_m, t.id_c, 'marca_linha'::text origem, t.pos::numeric ord, t.j afin, t.preco,
               t.tipo cat, coalesce(nm.n, 0) nmn, coalesce(s.sj, 0) sj,
               null::numeric p_classe, null::numeric p_s, null::numeric lift
        from t_compat t
        left join nm on nm.id_produto = t.id_m
        left join t_sj s on s.id_m = t.id_m and s.id_c = t.id_c
        where t.pos <= p_max_compat
    ),
    calc as (
        select m.id_produto id_m, c.id_produto id_c, c.cat, c.preco, c.f,
               coalesce(nm.n, 0) nmn, coalesce(s.sj, 0) sj, c.cj / ncl.n p_classe,
               (coalesce(s.sj, 0) + p_k * (c.cj / ncl.n)) / (coalesce(nm.n, 0) + p_k) p_s
        from t_mach m
        cross join t_cand c
        cross join ncl
        left join nm on nm.id_produto = m.id_produto
        left join t_sj s on s.id_m = m.id_produto and s.id_c = c.id_produto
        left join t_prod cb on cb.id_produto = c.id_produto
        where c.id_produto <> m.id_produto
          and c.cat <> m.tipo
          and (c.cat not in ('MAQ_CORTE', 'MAQ_ACABAMENTO', 'MAQ_SHAVER') or (cb.marca is not null and cb.marca = m.marca))
          and not exists (select 1 from comp x where x.id_m = m.id_produto and x.id_c = c.id_produto)
    ),
    f as (
        select calc.*, calc.p_s / (calc.f / tot.n) lift
        from calc cross join tot
        where calc.p_s / (calc.f / tot.n) >= 1.2
    ),
    r1 as (select f.*, row_number() over (partition by id_m, cat order by p_s desc, preco desc) rc from f),
    r2 as (select r1.*, row_number() over (partition by id_m order by p_s desc, preco desc) rk from r1 where rc <= 2),
    beh as (
        select id_m, id_c, 'historico'::text origem, (100 + rk)::numeric ord, null::numeric afin, preco, cat,
               nmn, sj, p_classe, p_s, lift
        from r2
    ),
    u as (select * from comp union all select * from beh),
    pos as (select u.*, row_number() over (partition by id_m order by ord) posicao from u)
    select pos.id_m, pm.codigo, pm.nome, pos.posicao::smallint, pos.id_c, pc.codigo, pc.nome, pos.cat,
           round(pos.preco, 2), pos.nmn::int, pos.sj::int,
           case when pos.nmn > 0 then round(pos.sj / pos.nmn, 4) end,
           round(pos.p_classe, 4), round(pos.p_s, 4), round(pos.lift, 2), round(pos.p_s * pos.preco, 2),
           'acab_shaver_v1', v_ini, v_fim, pos.origem, round(pos.afin, 2), pm.marca
    from pos
    join t_prod pm on pm.id_produto = pos.id_m
    join t_prod pc on pc.id_produto = pos.id_c
    where pos.posicao <= 5;

    return query
    select count(distinct id_produto)::int, count(*)::int
    from barbers.produtos_relacionados where regra = 'acab_shaver_v1';
end;
$$;

revoke all on function barbers.recalcular_relacionados_acab_shaver(int, int, numeric, numeric, int)
    from public, anon, authenticated;
