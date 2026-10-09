'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useCanaisIntegracoes, type CanalIntegracao } from '@/hooks/use-canais-integracoes'
import { CadastrarCanalDialog } from '@/components/canais-venda/cadastrar-canal-dialog'
import { CLASSE_LOGO_CANAL, logoDoCanal } from '@/lib/canais'

const STATUS: Record<CanalIntegracao['status'], { rotulo: string; classe: string }> = {
  conectado: { rotulo: 'Conectado', classe: 'bg-emerald-100 text-emerald-800' },
  pendente: { rotulo: 'Aguardando autorização', classe: 'bg-amber-100 text-amber-800' },
  erro: { rotulo: 'Erro', classe: 'bg-red-100 text-red-800' },
}

function Conteudo() {
  const { canais, config, loading, erro, cadastrar, reconectar, excluir, recarregar } = useCanaisIntegracoes()
  const [dialogAberto, setDialogAberto] = useState(false)
  const params = useSearchParams()
  const router = useRouter()

  // Retorno do callback da Nuvemshop (?conectado=1 ou ?erro=...): avisa e limpa a URL.
  useEffect(() => {
    const conectado = params.get('conectado')
    const falha = params.get('erro')
    if (!conectado && !falha) return
    if (conectado) toast.success('Canal conectado com a Nuvemshop.')
    if (falha) toast.error(falha)
    router.replace('/canais-venda')
    void recarregar()
  }, [params, router, recarregar])

  const handleReconectar = async (c: CanalIntegracao) => {
    try {
      window.location.href = await reconectar(c.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível reconectar.')
    }
  }

  const handleExcluir = async (c: CanalIntegracao) => {
    if (!window.confirm(`Remover o canal "${c.nome}"? O token guardado será apagado.`)) return
    try {
      await excluir(c.id)
      toast.success('Canal removido.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível remover.')
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Canais de Venda</h1>
          <p className="text-sm text-muted-foreground">Conecte as plataformas onde a Barbers World vende</p>
        </div>
        <Button onClick={() => setDialogAberto(true)}>
          <Plus className="size-4" />
          Cadastrar canal
        </Button>
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {loading ? (
        <Skeleton className="h-28 w-full" />
      ) : canais.length === 0 && !erro ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhum canal cadastrado</CardTitle>
            <CardDescription>Clique em “Cadastrar canal”, escolha a Nuvemshop e siga os passos.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {canais.map((c) => {
            const logo = logoDoCanal('Nuvemshop')
            const st = STATUS[c.status]
            return (
              <Card key={c.id}>
                <CardHeader className="flex-row items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {logo && <img src={logo} alt="" className={`mt-1 size-8 ${CLASSE_LOGO_CANAL}`} />}
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate">{c.nome}</CardTitle>
                    <CardDescription className="truncate">
                      Nuvemshop{c.store_nome ? ` · ${c.store_nome}` : ''}
                    </CardDescription>
                  </div>
                  <Badge className={st.classe} variant="secondary">{st.rotulo}</Badge>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  {c.store_id && (
                    <p className="text-muted-foreground">
                      Loja nº {c.store_id}
                      {c.store_url ? ` · ${c.store_url}` : ''}
                    </p>
                  )}
                  {c.conectado_em && (
                    <p className="text-muted-foreground">
                      Conectado em {new Date(c.conectado_em).toLocaleString('pt-BR')}
                    </p>
                  )}
                  {c.ultimo_erro && <p className="text-destructive">{c.ultimo_erro}</p>}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleReconectar(c)}>
                      <RefreshCw className="size-4" />
                      {c.status === 'conectado' ? 'Reconectar' : 'Autorizar'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleExcluir(c)}>
                      <Trash2 className="size-4" />
                      Remover
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <CadastrarCanalDialog open={dialogAberto} onOpenChange={setDialogAberto} config={config} onCadastrar={cadastrar} />
    </div>
  )
}

export default function CanaisVendaPage() {
  return (
    <Suspense>
      <Conteudo />
    </Suspense>
  )
}
