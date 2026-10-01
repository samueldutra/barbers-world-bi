-- Bucket público com as imagens dos produtos (copiadas por sync-produtos-bling.py).
-- O Bling devolve imagemURL como link ASSINADO do S3 que vence em ~30 min; o BI usa o link
-- público e permanente deste bucket. Leitura pública (é só thumbnail de produto); escrita
-- só com service_role (o ETL), que ignora RLS — nenhuma policy de escrita é criada.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('produtos-imagens', 'produtos-imagens', true, 5242880, ARRAY['image/*'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public,
                               file_size_limit = EXCLUDED.file_size_limit,
                               allowed_mime_types = EXCLUDED.allowed_mime_types;
