#!/usr/bin/env python3
"""Gera o SQL que instala o schema de dados de um NOVO cliente (tenant) no Supabase.

Uso (na raiz do repositório):
    python3 scripts/gerar-sql-tenant.py <slug> <schema> "<Nome do cliente>" [conta_bling] > instalar-<slug>.sql

Cole o resultado no SQL Editor do Supabase (ou aplique pelo MCP). Exige que sql/multi_tenant.sql e
sql/multi_tenant_fase2.sql já estejam aplicados.

O que entra: CREATE SCHEMA, tabelas, índices, views, triggers e as funções DO SCHEMA (as que o próprio
SQL cria como `barbers.<função>`), tudo com `barbers` trocado pelo schema novo; e o cadastro em
public.tenants. O que NÃO entra, de propósito:
  * funções `public.*` / RPCs (são compartilhadas por todos os tenants e já estão instaladas);
  * INSERT/UPDATE/DELETE dos arquivos (dados da Barbers: canais, de-para de lojas, situações);
  * scripts só da Barbers (titulos_*, seed_sku_bling_propostas, debug_*, comparação de preços).
O catálogo de municípios (<schema>.cidades) é copiado do schema `barbers` se ele existir.
"""
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA_ORIGEM = "barbers"

# Ordem importa (chaves, views e triggers dependem de tabelas anteriores).
ARQUIVOS = [
    "etl-bling-pedidos-vendas/sql/create_table_canais_venda.sql",
    "etl-bling-pedidos-vendas/sql/create_table_contatos.sql",
    "etl-bling-pedidos-vendas/sql/create_table_produtos.sql",
    "etl-bling-pedidos-vendas/sql/create_table_situacoes_pedido.sql",
    "etl-bling-pedidos-vendas/sql/create_table_pedidos_vendas.sql",
    "etl-bling-pedidos-vendas/sql/create_table_canais_venda_de_para.sql",
    "etl-bling-pedidos-vendas/sql/create_table_produtos_lojas.sql",
    "etl-bling-pedidos-vendas/sql/rpc_estoque_bling_nuvemshop.sql",
    "etl-bling-pedidos-vendas/sql/rpc_vinculos_lote_loja.sql",
    "etl-nuvemshop-pedidos/sql/create_table_nuvemshop_pedidos.sql",
    "etl-nuvemshop-produtos/sql/create_table_nuvemshop_produtos.sql",
    "etl-nuvemshop-produtos/sql/marca_categoria.sql",
    "etl-mercadolivre-pedidos/sql/create_table_mercadolivre_pedidos.sql",
    "dashboard/sql/rpc_conferencia_precos.sql",
    "dashboard/sql/rpc_vinculo_sku_alteracao.sql",
    "dashboard/sql/rpc_sku_bling_propostas.sql",
    "dashboard/sql/rpc_vinculo_sku_pedidos.sql",
    "dashboard/sql/rpc_prospeccao_leads.sql",
    "dashboard/sql/rpc_prospeccao_rotas.sql",
    "dashboard/sql/rpc_prospeccao_cidades.sql",
]

MANTER = re.compile(
    r"^(CREATE\s+(UNIQUE\s+)?INDEX|CREATE\s+TABLE|CREATE\s+(OR\s+REPLACE\s+)?VIEW|CREATE\s+TRIGGER"
    r"|CREATE\s+SEQUENCE|ALTER\s+TABLE|CREATE\s+OR\s+REPLACE\s+FUNCTION\s+" + SCHEMA_ORIGEM + r"\.)",
    re.I,
)


def separar_comandos(sql: str):
    """Divide em comandos por `;` respeitando comentários, 'strings' e blocos $$...$$."""
    comandos, atual = [], []
    i, n = 0, len(sql)
    em_dolar = em_aspas = False
    while i < n:
        c = sql[i]
        if not em_dolar and not em_aspas and sql.startswith("--", i):
            fim = sql.find("\n", i)
            i = n if fim == -1 else fim  # descarta o comentário, mantém a quebra de linha
            continue
        if not em_aspas and sql.startswith("$$", i):
            em_dolar = not em_dolar
            atual.append("$$")
            i += 2
            continue
        if not em_dolar and c == "'":
            em_aspas = not em_aspas
        if c == ";" and not em_dolar and not em_aspas:
            comando = "".join(atual).strip()
            if comando:
                comandos.append(comando)
            atual = []
        else:
            atual.append(c)
        i += 1
    resto = "".join(atual).strip()
    if resto:
        comandos.append(resto)
    return comandos


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    slug, schema, nome = sys.argv[1], sys.argv[2], sys.argv[3]
    conta = sys.argv[4] if len(sys.argv) > 4 else slug
    if not re.fullmatch(r"[a-z][a-z0-9-]*", slug):
        sys.exit("slug inválido: use minúsculas, números e hífen")
    if not re.fullmatch(r"[a-z][a-z0-9_]*", schema) or schema in (SCHEMA_ORIGEM, "public", "auth", "storage"):
        sys.exit("schema inválido ou reservado")
    q = lambda v: "'" + v.replace("'", "''") + "'"

    saida = [
        f"-- Instalação do cliente '{nome}' (slug {slug}, schema {schema}). Gerado por scripts/gerar-sql-tenant.py.",
        "-- Pré-requisito: sql/multi_tenant.sql e sql/multi_tenant_fase2.sql aplicados.",
        "BEGIN;",
        f"CREATE SCHEMA IF NOT EXISTS {schema};",
    ]
    descartados = {}
    for rel in ARQUIVOS:
        caminho = os.path.join(RAIZ, rel)
        with open(caminho, encoding="utf-8") as f:
            comandos = separar_comandos(f.read())
        saida.append(f"\n-- ==== {rel}")
        for cmd in comandos:
            if MANTER.match(cmd):
                saida.append(re.sub(rf"\b{SCHEMA_ORIGEM}\b", schema, cmd) + ";")
            else:
                chave = " ".join(cmd.split()[:3]).upper()
                descartados[chave] = descartados.get(chave, 0) + 1

    saida += [
        "\n-- Catálogo de municípios do IBGE: copia do schema original, se existir.",
        "DO $$ BEGIN",
        f"  IF to_regclass('{SCHEMA_ORIGEM}.cidades') IS NOT NULL THEN",
        f"    INSERT INTO {schema}.cidades SELECT * FROM {SCHEMA_ORIGEM}.cidades ON CONFLICT DO NOTHING;",
        "  END IF;",
        "END $$;",
        "\n-- Cadastro do cliente.",
        "INSERT INTO public.tenants (slug, nome, schema_name, conta_bling)",
        f"VALUES ({q(slug)}, {q(nome)}, {q(schema)}, {q(conta)})",
        "ON CONFLICT (slug) DO NOTHING;",
        "COMMIT;",
    ]
    texto = "\n".join(saida) + "\n"
    restantes = len(re.findall(rf"\b{SCHEMA_ORIGEM}\b", texto.split("-- Catálogo de municípios")[0]))
    sys.stdout.write(texto)
    print(f"-- (comandos descartados: {descartados})", file=sys.stderr)
    if restantes:
        print(f"AVISO: {restantes} menção(ões) a '{SCHEMA_ORIGEM}' sobraram antes da cópia de cidades; revise.", file=sys.stderr)


if __name__ == "__main__":
    main()
