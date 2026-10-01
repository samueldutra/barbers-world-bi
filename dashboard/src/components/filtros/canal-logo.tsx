import Image from 'next/image'
import { cn } from 'cn'
import { CLASSE_LOGO_CANAL, logoDoCanal } from '@/lib/canais'

interface Props {
  grupo: string | null | undefined
  /** Lado do quadrado, em px. */
  tamanho?: number
  className?: string
}

/** Logo do canal (marketplace/loja) — nada quando o grupo não tem logo cadastrada. */
export function CanalLogo({ grupo, tamanho = 16, className }: Props) {
  const src = logoDoCanal(grupo)
  if (!src) return null
  return (
    <Image
      src={src}
      alt=""
      aria-hidden
      width={tamanho}
      height={tamanho}
      // Fixa as duas dimensões: o preflight do Tailwind põe height:auto em <img>, o que
      // distorce (e gera warning do next/image) em logos não quadradas, como a do TikTok.
      style={{ width: tamanho, height: tamanho }}
      className={cn(CLASSE_LOGO_CANAL, className)}
    />
  )
}
