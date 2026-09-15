import { ShieldOff } from 'lucide-react'

export default function SemAcessoPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <ShieldOff className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold">Nenhum módulo liberado</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Seu usuário ainda não tem acesso a nenhuma tela do sistema. Fale com o administrador
        pra liberar os módulos que você precisa.
      </p>
    </div>
  )
}
