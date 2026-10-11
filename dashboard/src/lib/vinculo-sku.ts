/** Status do cruzamento SKU Nuvemshop × Bling (ver sql/rpc_vinculo_sku_nuvemshop.sql). */
export type StatusVinculo =
  | 'vinculado'
  | 'vinculado_ajustar'
  | 'sku_duplicado'
  | 'sem_correspondencia'
  | 'sem_sku'
  | 'so_bling'

export interface InfoStatusVinculo {
  label: string
  /** Explicação curta (tooltip/legenda). */
  descricao: string
  /** Classes do selo e do cartão — cor indica gravidade. */
  classe: string
}

export const STATUS_VINCULO: Record<StatusVinculo, InfoStatusVinculo> = {
  vinculado: {
    label: 'Vinculado',
    descricao: 'O SKU é idêntico ao de um único produto ativo do Bling.',
    classe: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  vinculado_ajustar: {
    label: 'Ajustar SKU',
    descricao: 'Casa com o Bling só depois de ignorar espaços e maiúsculas/minúsculas — corrigir o SKU na Nuvemshop.',
    classe: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  },
  sku_duplicado: {
    label: 'SKU duplicado',
    descricao: 'O mesmo SKU aparece em mais de uma variante da Nuvemshop ou em mais de um produto do Bling.',
    classe: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  sem_correspondencia: {
    label: 'Sem correspondência',
    descricao: 'SKU preenchido, mas não existe produto ativo com esse código no Bling.',
    classe: 'bg-destructive/10 text-destructive',
  },
  sem_sku: {
    label: 'Sem SKU',
    descricao: 'Variante publicada sem SKU — não tem como vincular ao Bling.',
    classe: 'bg-destructive/10 text-destructive',
  },
  so_bling: {
    label: 'Só no Bling',
    descricao: 'Produto ativo no Bling sem nenhuma variante com esse SKU na Nuvemshop.',
    classe: 'bg-muted text-muted-foreground',
  },
}

/** Ordem dos cartões/opções: do que está certo ao que mais precisa de atenção. */
export const ORDEM_STATUS_VINCULO: StatusVinculo[] = [
  'vinculado',
  'vinculado_ajustar',
  'sku_duplicado',
  'sem_correspondencia',
  'sem_sku',
  'so_bling',
]

export function infoStatusVinculo(status: string): InfoStatusVinculo {
  return STATUS_VINCULO[status as StatusVinculo] ?? { label: status, descricao: '', classe: 'bg-muted text-muted-foreground' }
}

export interface ConfiancaSugestao {
  label: string
  classe: string
}

/** Rótulo da sugestão pela pontuação de similaridade (faixas calibradas com os dados reais; ver o SQL). */
export function confiancaSugestao(score: number): ConfiancaSugestao {
  if (score >= 0.999) return { label: 'Nome idêntico', classe: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' }
  if (score >= 0.8) return { label: 'Provável', classe: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' }
  if (score >= 0.6) return { label: 'Possível', classe: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' }
  return { label: 'Fraca — conferir', classe: 'bg-muted text-muted-foreground' }
}
