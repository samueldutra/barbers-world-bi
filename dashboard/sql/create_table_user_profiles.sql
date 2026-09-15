-- Perfis de usuário do BI (login + gestão de acesso). Fica em public, é infraestrutura de
-- auth, não dado de negócio do tenant (esse fica nos schemas por cliente, ex.: barbers).
--
-- Sem papéis/perfis: só um flag `is_superadmin` (acesso total) + a lista de módulos
-- liberados por usuário em public.user_authorized_modules (ver sql/user_modulos_acesso.sql).

CREATE TABLE IF NOT EXISTS public.user_profiles (
    id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name         TEXT,
    is_superadmin     BOOLEAN NOT NULL DEFAULT false,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    theme_preference  TEXT CHECK (theme_preference IN ('light', 'dark')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Usuário lê e atualiza só o próprio perfil.
CREATE POLICY "user_profiles_select_own" ON public.user_profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "user_profiles_update_own" ON public.user_profiles
    FOR UPDATE USING (auth.uid() = id);

-- Cria o perfil automaticamente em qualquer INSERT em auth.users (signUp público, quando
-- habilitado, ou criação via Admin API pela tela de Usuários). O primeiro usuário do
-- sistema precisa ser promovido a super admin à mão:
-- UPDATE public.user_profiles SET is_superadmin = true WHERE id = '<uuid>'.
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
