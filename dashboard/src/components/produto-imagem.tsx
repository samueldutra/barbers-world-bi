'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Package } from 'lucide-react'
import { cn } from 'cn'

interface Props {
  src: string | null | undefined
  alt: string
  /** Lado do quadrado, em px. */
  tamanho: number
  className?: string
}

/** Miniatura do produto. Sem imagem, ou se a imagem falhar ao carregar (ex.: link do Bling
 * vencido — ver BUCKET_IMAGENS em etl-bling-pedidos-vendas/sync-produtos-bling.py), mostra o
 * ícone de pacote em vez do ícone de imagem quebrada do navegador. */
export function ProdutoImagem({ src, alt, tamanho, className }: Props) {
  const [falhou, setFalhou] = useState<string | null>(null)
  const mostrarImagem = !!src && falhou !== src

  return (
    <div
      className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted', className)}
      style={{ width: tamanho, height: tamanho }}
    >
      {mostrarImagem ? (
        <Image
          src={src}
          alt={alt}
          width={tamanho}
          height={tamanho}
          className="h-full w-full object-cover"
          unoptimized
          onError={() => setFalhou(src)}
        />
      ) : (
        <Package className="h-1/2 w-1/2 text-muted-foreground" />
      )}
    </div>
  )
}
