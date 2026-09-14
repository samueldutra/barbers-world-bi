'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { formatarMoeda, formatarNumero, formatarPercentual } from '@/lib/formatters'
import type { ClasseAbc } from '@/hooks/use-curva-abc'
import type { ClienteCurvaAbc } from '@/hooks/use-curva-abc-clientes'

const VARIANTE_POR_CLASSE: Record<ClasseAbc, 'default' | 'secondary' | 'outline'> = {
  A: 'default',
  B: 'secondary',
  C: 'outline',
}

interface Props {
  clientes: ClienteCurvaAbc[]
  loading: boolean
  limite: number
}

export function CurvaAbcClientesTabela({ clientes, loading, limite }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Curva ABC de clientes</CardTitle>
        <CardDescription>
          Concentração de faturamento por cliente — A: até 80%, B: até 95%, C: restante. Top {limite} por valor vendido.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : clientes.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma venda encontrada para este período/filtro.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Classe</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="text-right">Faturamento</TableHead>
                <TableHead className="text-right">% participação</TableHead>
                <TableHead className="text-right">% acumulado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientes.map((cliente, index) => (
                <TableRow key={`${cliente.id_contato ?? cliente.documento_contato ?? 'cliente'}-${index}`}>
                  <TableCell>
                    <Badge variant={VARIANTE_POR_CLASSE[cliente.classe_abc]}>{cliente.classe_abc}</Badge>
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-sm font-medium">{cliente.nome_contato || 'Cliente sem nome'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{cliente.documento_contato || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatarNumero(Number(cliente.total_pedidos))}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatarMoeda(Number(cliente.faturamento))}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatarPercentual(Number(cliente.percentual_participacao))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatarPercentual(Number(cliente.percentual_acumulado))}
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
