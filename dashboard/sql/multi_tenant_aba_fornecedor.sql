-- Barbers World: aba "Atacado" no Dashboard, entre Loja Física e Nuvemshop.
--   * A aba (rótulo "Atacado", id interno 'fornecedor') não fixa canal: filtra só a situação Fornecedor (id 453473).
--   * `situacoes_extra_dashboard`: Fornecedor passa a SOMAR no padrão da aba Geral (antes, por herdar
--     de Em aberto, ficava de fora). Requer a nova situacoes_padrao_dashboard() (rpc_dashboard_vendas.sql).
-- Aplicar DEPOIS do deploy do frontend e da RPC. Idempotente.
UPDATE public.tenants
SET config = jsonb_set(
        jsonb_set(
            config,
            '{abas}',
            (
                SELECT jsonb_agg(a ORDER BY ord)
                FROM (
                    SELECT a, ord FROM jsonb_array_elements(config->'abas') WITH ORDINALITY AS t(a, ord)
                    WHERE a->>'id' <> 'fornecedor'
                    UNION ALL
                    -- ord 1.5: logo depois de Loja Física (1), antes de Nuvemshop (2)
                    SELECT jsonb_build_object('id', 'fornecedor', 'label', 'Atacado', 'situacoes_padrao', jsonb_build_array(453473)),
                           (SELECT ord + 0.5 FROM jsonb_array_elements(config->'abas') WITH ORDINALITY AS t(a, ord) WHERE a->>'id' = 'loja-fisica')
                ) x
            )
        ),
        '{situacoes_extra_dashboard}',
        '[453473]'::jsonb
    )
WHERE slug = 'barbers';
