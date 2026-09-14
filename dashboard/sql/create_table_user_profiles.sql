-- Perfis de usuário do BI (login/roles). Fica em public, é infraestrutura de auth,
-- não dado de negócio do tenant (esse fica nos schemas por cliente, ex.: barbers).

CREATE TABLE IF NOT EXISTS public.user_profiles (
    id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name         TEXT,
    role              TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('superadmin', 'admin', 'user', 'viewer')),
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

-- Cria o perfil automaticamente quando um usuário se cadastra (signUp).
-- O primeiro usuário criado manualmente precisa ter o role promovido à mão
-- (UPDATE public.user_profiles SET role = 'superadmin' WHERE id = '<uuid>').
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.user_profiles (id, full_name, role, is_active)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        'user',
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
