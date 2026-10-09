-- Fecha o acesso público às funções do banco (achado do code review de 09/10/2026).
--
-- Problema: as funções SECURITY DEFINER do schema public (rodam como dono do banco) nasceram
-- com EXECUTE para PUBLIC, então QUALQUER pessoa com a chave anon (que é pública: vai no código
-- do navegador) chamava relatórios de clientes, excluía leads/rotas, disparava as cargas do ETL
-- e usava as funções debug_* (que leem qualquer tabela de qualquer schema).
--
-- Efeito deste script:
--   1) Garante EXECUTE explícito para "authenticated" nas funções que o app chama (pra nada
--      depender do EXECUTE implícito de PUBLIC, que vai ser removido). Roda em TODAS; o passo 3
--      retira de novo as que são só do servidor.
--   2) Tira EXECUTE de PUBLIC e de "anon" em TODAS as funções SECURITY DEFINER do public.
--   3) ETL e funções internas (carga, sync, mapeamento de cidades, auditoria de preço): só
--      "service_role" (o ETL e as rotas de API usam a chave de serviço; ver ATENÇÃO).
--   4) Funções debug_*: ninguém (nem o app as usa).
--
-- APLICADO em produção em 09/10/2026 (com a lista do passo 3 completa; uma 1ª versão deste script
-- esqueceu de retirar de "authenticated" as funções internas do mapeamento e foi corrigida na hora).
--
-- ATENÇÃO antes de aplicar: o ETL (GitHub Actions) e as rotas /api/usuarios usam a chave
-- SUPABASE_SERVICE_KEY / SUPABASE_SERVICE_ROLE_KEY. Elas PRECISAM ser a chave com papel
-- service_role (não a anon). Depois de aplicar, rode o workflow do ETL manualmente
-- (Actions > "ETL Bling" > Run workflow) pra confirmar.
--
-- Desfazer (se algo quebrar): GRANT EXECUTE ON FUNCTION <função> TO anon;  (ou PUBLIC)

DO $$
DECLARE
    r RECORD;
BEGIN
    -- 1) authenticated explícito em tudo que é SECURITY DEFINER (rede de segurança)
    FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p
             WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.f);
    END LOOP;

    -- 2) fora PUBLIC e anon
    FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p
             WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.f);
    END LOOP;

    -- 3) ETL e internas: só service_role
    FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p
             WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
               AND (p.proname LIKE 'processar_carga_%'
                    OR p.proname IN ('inativar_produtos_fora_listagem', 'obter_contatos_pendentes_sync',
                                     'obter_produtos_pendentes_sync', 'handle_new_user', 'rls_auto_enable',
                                     'obter_mapeamento_cidade', 'salvar_progresso_mapeamento',
                                     'concluir_mapeamento_cidade', 'falhar_mapeamento_cidade',
                                     'listar_mapeamentos_travados', 'reivindicar_mapeamento_cidade', 'iniciar_mapeamento_cidade',
                                     'registrar_alteracao_preco')) LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.f);
    END LOOP;

    -- 4) debug_*: ninguém além do service_role
    FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p
             WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'debug\_%' LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.f);
    END LOOP;
END $$;
