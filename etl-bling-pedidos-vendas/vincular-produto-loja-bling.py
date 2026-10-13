"""
TESTE DE ESCRITA — cria o vínculo produto x loja virtual do Bling para UM produto: o campo "ID na loja" (`codigo`, na
Nuvemshop = ID do PRODUTO na Nuvemshop) mais os preços da loja. Grava via POST /produtos/lojas (ou PUT /produtos/lojas/{id}
se a loja já estiver marcada com ID 0) e RELÊ tudo no Bling pra conferir. Roda pelo disparo manual do etl-hourly.yml
(campo vincular_produto_loja = "ID_PRODUTO:ID_LOJA:ID_NA_LOJA:PRECO_CADASTRO:PRECO_VINCULO:ESTOQUE_ESPERADO").

REGRA: os preços NÃO mudam. O cadastro do produto no Bling é só conferido (e relido no fim); o preço do vínculo é o que a loja já
pratica hoje (o preço da Nuvemshop), pra o Bling não ter motivo de alterar o preço da loja. Só o ID na loja é gravado de novo.

Travas (aborta SEM gravar se qualquer uma falhar):
  - só a loja NUVEMSHOP BARBERS WORLD (206304549);
  - o produto existe, está ativo e o preço atual do cadastro é o PRECO_CADASTRO informado;
  - ainda não tem vínculo nessa loja (ou tem com ID 0);
  - o saldo de estoque no Bling é igual ao ESTOQUE_ESPERADO (o da Nuvemshop): com o vínculo ativo o Bling pode passar a
    enviar o estoque dele pra loja, então saldo diferente = a loja mudaria de estoque.
Depois de gravar: confere `codigo`, preço e promoção do vínculo, que o preço do cadastro e o saldo de estoque não mudaram.

Reaproveita a sessão/OAuth de sync-canais-venda-bling.py (duplicação de infraestrutura já é a convenção desta pasta).
"""

import importlib.util
import json
import os
import sys
import traceback

_spec = importlib.util.spec_from_file_location("sync_canais", os.path.join(os.path.dirname(__file__), "sync-canais-venda-bling.py"))
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)

LOJA_PERMITIDA = 206304549  # NUVEMSHOP BARBERS WORLD (barbers.canais_venda.id_loja)


class Abortar(Exception):
    """Trava de segurança: nada foi gravado."""


def chamar(cliente: str, conta: str, metodo: str, path: str, params: dict = None, corpo: dict = None):
    """Chamada ao Bling (GET/POST/PUT) com renovação de token em 401. Devolve (status, json|texto)."""
    for tentativa in range(2):
        token = base.obter_access_token_valido(cliente, conta, forcar_refresh=(tentativa > 0))
        base.bling_rate_limiter.aguardar()
        resp = base.get_http_session().request(
            metodo, f"{base.BLING_BASE_URL}{path}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json", "Content-Type": "application/json"},
            params=params or {}, data=json.dumps(corpo) if corpo is not None else None, timeout=60,
        )
        if resp.status_code == 401 and tentativa == 0:
            continue
        try:
            return resp.status_code, resp.json()
        except ValueError:
            return resp.status_code, resp.text[:500]
    return 401, "401 mesmo após renovar o token"


def ler(cliente, conta, path, params=None):
    status, corpo = chamar(cliente, conta, "GET", path, params)
    if status >= 400:
        raise RuntimeError(f"GET {path} falhou ({status}): {str(corpo)[:500]}")
    return corpo


def saldo_estoque(cliente, conta, id_produto):
    corpo = ler(cliente, conta, "/estoques/saldos", {"idsProdutos[]": id_produto})
    itens = corpo.get("data") or []
    if not itens:
        raise RuntimeError("O Bling não devolveu saldo de estoque para o produto.")
    return float(itens[0].get("saldoVirtualTotal", 0)), float(itens[0].get("saldoFisicoTotal", 0))


def main():
    cliente = os.getenv("ETL_CLIENTE")
    bruto = os.getenv("VINCULAR", "")
    try:
        id_produto, id_loja, id_na_loja, preco_cadastro, preco_vinculo, estoque_esperado = bruto.split(":")
        id_produto, id_loja = int(id_produto), int(id_loja)
        preco_cadastro, preco_vinculo, estoque_esperado = float(preco_cadastro), float(preco_vinculo), float(estoque_esperado)
        if not id_na_loja.isdigit() or id_na_loja == "0":
            raise ValueError("ID na loja inválido")
    except ValueError as e:
        base.log(f"[ERRO] Formato esperado ID_PRODUTO:ID_LOJA:ID_NA_LOJA:PRECO_CADASTRO:PRECO_VINCULO:ESTOQUE_ESPERADO — recebido '{bruto}' ({e})")
        sys.exit(1)
    if not cliente:
        base.log("[ERRO] ETL_CLIENTE não definido")
        sys.exit(1)
    config = base.obter_configuracoes_clientes().get(cliente, {})
    conta = config.get("conta_bling", cliente)

    base.log("=" * 60)
    base.log(f"VINCULAR PRODUTO x LOJA (BLING) — ESCRITA | produto {id_produto} | loja {id_loja} | ID na loja {id_na_loja} | preço do cadastro {preco_cadastro} (não muda) | preço do vínculo {preco_vinculo} | estoque esperado {estoque_esperado}")
    base.log("=" * 60)

    try:
        if id_loja != LOJA_PERMITIDA:
            raise Abortar(f"Loja {id_loja} não permitida (só {LOJA_PERMITIDA}).")

        # 1) O produto é o esperado.
        produto = ler(cliente, conta, f"/produtos/{id_produto}")["data"]
        base.log(f"Produto: {produto.get('codigo')} | {produto.get('nome')} | situação {produto.get('situacao')} | preço {produto.get('preco')}")
        if produto.get("situacao") != "A":
            raise Abortar("Produto não está ativo.")
        if abs(float(produto.get("preco") or 0) - preco_cadastro) > 0.005:
            raise Abortar(f"Preço do cadastro ({produto.get('preco')}) difere do esperado ({preco_cadastro}).")

        # 2) Vínculo atual na loja.
        vinculos = ler(cliente, conta, "/produtos/lojas", {"idProduto": id_produto}).get("data") or []
        da_loja = [v for v in vinculos if (v.get("loja") or {}).get("id") == id_loja]
        base.log(f"Vínculos atuais do produto: {len(vinculos)} (na loja alvo: {len(da_loja)}) -> {json.dumps(da_loja, ensure_ascii=False)}")
        existente = None
        if len(da_loja) > 1:
            raise Abortar("Mais de um vínculo na loja alvo — situação inesperada.")
        if da_loja:
            if str(da_loja[0].get("codigo")) not in ("0", ""):
                raise Abortar(f"Já existe vínculo com ID {da_loja[0].get('codigo')} nessa loja — nada a fazer.")
            existente = da_loja[0]

        # 3) Estoque do Bling = estoque da loja (senão a loja mudaria de estoque).
        virtual_antes, fisico_antes = saldo_estoque(cliente, conta, id_produto)
        base.log(f"Saldo no Bling antes: virtual {virtual_antes} | físico {fisico_antes}")
        if abs(virtual_antes - estoque_esperado) > 0.0005:
            raise Abortar(f"Saldo virtual do Bling ({virtual_antes}) difere do estoque da Nuvemshop ({estoque_esperado}); "
                          "gravar o vínculo poderia alterar o estoque da loja.")

        # 4) Grava.
        corpo = {
            "codigo": id_na_loja,
            "preco": preco_vinculo,
            "precoPromocional": 0,
            "produto": {"id": id_produto},
            "loja": {"id": id_loja},
            "fornecedorLoja": {"id": 0},
            "marcaLoja": {"id": 0},
            "categoriasProdutos": [],
        }
        if existente:
            metodo, path = "PUT", f"/produtos/lojas/{existente['id']}"
        else:
            metodo, path = "POST", "/produtos/lojas"
        base.log(f">>> {metodo} {path} corpo={json.dumps(corpo, ensure_ascii=False)}")
        status, resposta = chamar(cliente, conta, metodo, path, corpo=corpo)
        base.log(f"<<< HTTP {status}: {json.dumps(resposta, ensure_ascii=False)[:1500] if not isinstance(resposta, str) else resposta}")
        if status >= 400:
            raise RuntimeError(f"O Bling recusou a gravação ({status}).")

        # 5) Relê e confere.
        depois = ler(cliente, conta, "/produtos/lojas", {"idProduto": id_produto}).get("data") or []
        novo = [v for v in depois if (v.get("loja") or {}).get("id") == id_loja]
        base.log(f"Vínculos DEPOIS na loja alvo: {json.dumps(novo, ensure_ascii=False)}")
        ok = (len(novo) == 1 and str(novo[0].get("codigo")) == id_na_loja
              and abs(float(novo[0].get("preco") or 0) - preco_vinculo) < 0.005 and float(novo[0].get("precoPromocional") or 0) == 0)
        virtual_depois, fisico_depois = saldo_estoque(cliente, conta, id_produto)
        produto_depois = ler(cliente, conta, f"/produtos/{id_produto}")["data"]
        base.log(f"Saldo no Bling depois: virtual {virtual_depois} | físico {fisico_depois} (antes {virtual_antes}/{fisico_antes})")
        base.log(f"Cadastro depois: preço {produto_depois.get('preco')} | código {produto_depois.get('codigo')} | situação {produto_depois.get('situacao')}")
        base.log("RESULTADO: " + ("SUCESSO — vínculo criado e conferido." if ok else "ATENÇÃO — o vínculo não ficou como esperado (ver acima)."))
        if not ok or virtual_depois != virtual_antes or float(produto_depois.get("preco") or 0) != float(produto.get("preco") or 0):
            sys.exit(2)
    except Abortar as e:
        base.log(f"ABORTADO SEM GRAVAR: {e}")
        sys.exit(3)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        base.log(f"Execução falhou: {e}")
        traceback.print_exc()
        sys.exit(1)
