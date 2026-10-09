'use client'

import { Label } from '@/components/ui/label'
import { FiltroCanais } from '@/components/filtros/filtro-canais'
import { FiltroSelecaoUnica } from '@/components/filtros/filtro-selecao-unica'
import { FiltrosDrawerBase } from '@/components/filtros/filtros-drawer-base'
import type { CanalVenda } from '@/hooks/use-canais-venda'

export interface FiltrosProdutos {
  canais: number[] | null
  marca: string | null
  categoria: string | null
}

interface Props {
  valor: FiltrosProdutos
  onAplicar: (novo: FiltrosProdutos) => void
  canais: CanalVenda[]
  marcas: string[]
  categorias: string[]
}

/** Filtros do relatório de produtos (Canais, Marca, Categoria) no drawer padrão. */
export function FiltrosProdutosDrawer({ valor, onAplicar, canais, marcas, categorias }: Props) {
  return (
    <FiltrosDrawerBase<FiltrosProdutos>
      valor={valor}
      onAplicar={onAplicar}
      contar={(v) => (v.canais && v.canais.length > 0 ? 1 : 0) + (v.marca ? 1 : 0) + (v.categoria ? 1 : 0)}
    >
      {(rascunho, atualizar) => (
        <>
          <div className="flex flex-col gap-2">
            <Label>Canais</Label>
            <FiltroCanais
              canais={canais}
              canaisSelecionados={rascunho.canais}
              onCanaisChange={(ids) => atualizar({ canais: ids })}
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Marca</Label>
            <FiltroSelecaoUnica
              label="Marca"
              opcoes={marcas}
              valor={rascunho.marca}
              onValorChange={(v) => atualizar({ marca: v })}
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Categoria</Label>
            <FiltroSelecaoUnica
              label="Categoria"
              opcoes={categorias}
              valor={rascunho.categoria}
              onValorChange={(v) => atualizar({ categoria: v })}
              className="w-full"
            />
          </div>
        </>
      )}
    </FiltrosDrawerBase>
  )
}
