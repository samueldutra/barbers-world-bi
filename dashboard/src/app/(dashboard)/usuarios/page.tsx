'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { UserPlus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useUsuarios, type Usuario, type ResultadoCriacao } from '@/hooks/use-usuarios'
import { useUser } from '@/hooks/use-user'
import { UsuariosLista } from '@/components/usuarios/usuarios-lista'
import { UsuarioFormDialog } from '@/components/usuarios/usuario-form-dialog'
import { LinkAcessoDialog, type AcessoGerado } from '@/components/usuarios/link-acesso-dialog'

export default function UsuariosPage() {
  const { usuarios, loading, criar, atualizar, excluir, gerarAcesso } = useUsuarios()
  const { user } = useUser()
  const [dialogAberto, setDialogAberto] = useState(false)
  const [usuarioEditando, setUsuarioEditando] = useState<Usuario | null>(null)
  const [acessoGerado, setAcessoGerado] = useState<AcessoGerado | null>(null)

  const handleCriado = (resultado: ResultadoCriacao, nome: string) => {
    setAcessoGerado({
      nome,
      email: resultado.email,
      emailEnviado: resultado.emailEnviado,
      erroEmail: resultado.erroEmail,
      link: resultado.linkAcesso,
    })
  }

  const handleGerarAcesso = async (usuario: Usuario, enviarEmail: boolean) => {
    const nome = usuario.full_name || usuario.email
    try {
      const { emailEnviado, link } = await gerarAcesso(usuario.id, enviarEmail)
      setAcessoGerado({ nome, email: usuario.email, emailEnviado, link })
    } catch (err) {
      console.error('Erro ao gerar acesso:', err)
      toast.error(err instanceof Error ? err.message : 'Não foi possível gerar o acesso.')
    }
  }

  const handleNovo = () => {
    setUsuarioEditando(null)
    setDialogAberto(true)
  }

  const handleEditar = (usuario: Usuario) => {
    setUsuarioEditando(usuario)
    setDialogAberto(true)
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Usuários</h1>
          <p className="text-sm text-muted-foreground">
            Cadastre pessoas e escolha quais módulos cada uma pode acessar
          </p>
        </div>
        <Button onClick={handleNovo}>
          <UserPlus className="h-4 w-4" />
          Novo usuário
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Todos os usuários</CardTitle>
          <CardDescription>Super admin tem acesso total por padrão — os demais só veem os módulos liberados</CardDescription>
        </CardHeader>
        <CardContent>
          <UsuariosLista
            usuarios={usuarios}
            loading={loading}
            usuarioAtualId={user?.id}
            onEditar={handleEditar}
            onExcluir={excluir}
            onGerarAcesso={handleGerarAcesso}
          />
        </CardContent>
      </Card>

      <UsuarioFormDialog
        open={dialogAberto}
        onOpenChange={setDialogAberto}
        usuario={usuarioEditando}
        onCriar={criar}
        onAtualizar={atualizar}
        onCriado={handleCriado}
      />

      <LinkAcessoDialog acesso={acessoGerado} onOpenChange={(v) => !v && setAcessoGerado(null)} />
    </div>
  )
}
