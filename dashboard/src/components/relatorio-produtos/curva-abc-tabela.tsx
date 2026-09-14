'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { formatarMoeda, formatarNumero, formatarPercentual } from '@/lib/formatters'
import type { CategoriaCurvaAbc, ClasseAbc } from '@/hooks/use-curva-abc'

const VARIANTE_POR_CLASSE: Record<ClasseAbc, 'default' | 'secondary' | 'outline'> = {
  A: 'default',
  B: 'secondary',
  C: 'outline',
}

interface Props {
  categorias: CategoriaCurvaAbc[]
  loading: boolean
}

export function CurvaAbcTabela({ categorias, loading }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Curva ABC por categoria</CardTitle>
        <CardDescription>
          Classificação pelo faturamento acumulado — A: até 80%, B: até 95%, C: restante
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : categorias.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma venda encontrada para este período/filtro.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Classe</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Qtde vendida</TableHead>
                <TableHead className="text-right">Faturamento</TableHead>
                <TableHead className="text-right">% participação</TableHead>
                <TableHead className="text-right">% acumulado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categorias.map((categoria) => (
                <TableRow key={categoria.categoria_descricao}>
                  <TableCell>
                    <Badge variant={VARIANTE_POR_CLASSE[categoria.classe_abc]}>{categoria.classe_abc}</Badge>
                  </TableCell>
                  <TableCell className="text-sm font-medium">{categoria.categoria_descricao}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatarNumero(Number(categoria.unidades_vendidas))}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatarMoeda(Number(categoria.faturamento))}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatarPercentual(Number(categoria.percentual_participacao))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatarPercentual(Number(categoria.percentual_acumulado))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
