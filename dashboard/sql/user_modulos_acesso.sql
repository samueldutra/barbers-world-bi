-- Gestão de usuários por módulo: substitui o modelo de papéis (superadmin/admin/user/
-- viewer) por um único flag `is_superadmin` + uma lista explícita de módulos liberados
-- por usuário. O super admin sempre tem acesso a tudo; os demais só veem o que foi
-- liberado na tela de Usuários.
--
-- Idempotente — seguro rodar de novo em cima de uma instalação que já tinha `role`.

-- 1) is_superadmin: adiciona e faz backfill a partir do role antigo (se existir).
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'role'
    ) THEN
        UPDATE public.user_profiles SET is_superadmin = true WHERE role = 'superadmin' AND NOT is_superadmin;
        ALTER TABLE public.user_profiles DROP COLUMN role;
    END IF;
END $$;

-- 2) Módulos liberados por usuário. IDs batem com src/types/modules.ts (SYSTEM_MODULES).
-- Não tem linha aqui = módulo não liberado. Super admin ignora essa tabela (acesso total
-- por definição, resolvido no código, não precisa de linha por módulo).
CREATE TABLE IF NOT EXISTS public.user_authorized_modules (
    user_id     UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    module      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, module)
);

ALTER TABLE public.user_authorized_modules ENABLE ROW LEVEL SECURITY;

-- Cada usuário só lê os próprios módulos liberados (usado pra montar o menu lateral).
-- Escrita (criar/editar/excluir usuário e seus módulos) acontece só via rotas de API
-- com o client admin (service_role), que ignora RLS — não precisa de policy de escrita
-- aqui, e é intencional: ninguém edita a própria lista de módulos direto pelo client.
DROP POLICY IF EXISTS "user_authorized_modules_select_own" ON public.user_authorized_modules;
CREATE POLICY "user_authorized_modules_select_own" ON public.user_authorized_modules
    FOR SELECT USING (auth.uid() = user_id);

-- 3) Trigger de criação de perfil (dispara em qualquer INSERT em auth.users, inclusive
-- quando o super admin cria alguém via Admin API) — atualizado pra não referenciar mais
-- `role`. A rota de criação (server-side) faz um upsert logo em seguida com os dados
-- reais (nome, is_superadmin); esse trigger só garante que a linha existe.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.user_profiles (id, full_name, is_superadmin, is_active)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        false,
        true
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;
