/** Exportação CSV/XLSX de relatórios (seção 27) — sempre client-side, respeitando os
 * filtros ativos (o chamador é responsável por buscar só os dados já filtrados). Genérico
 * por coluna pra ser reaproveitado por qualquer relatório tabular (produtos, clientes...). */

export interface ColunaExportavel<T> {
  cabecalho: string
  valor: (item: T) => string | number
  /** Só usado no XLSX (largura da coluna). */
  largura?: number
  /** Só usado no XLSX (ex.: '#,##0.00' pra colunas monetárias). */
  formatoNumerico?: string
}

function baixarArquivo(blob: Blob, nomeArquivo: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function escapeCSV(valor: string | number): string {
  const texto = typeof valor === 'number' ? valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : valor
  if (texto.includes(';') || texto.includes('"') || texto.includes('\n')) {
    return `"${texto.replace(/"/g, '""')}"`
  }
  return texto
}

/** CSV com delimitador ";" (padrão Excel pt-BR) e BOM UTF-8 (acentuação correta). */
export function exportarCSV<T>(itens: T[], colunas: ColunaExportavel<T>[], nomeArquivo: string) {
  const linhas = [colunas.map((c) => c.cabecalho), ...itens.map((item) => colunas.map((c) => c.valor(item)))]
  const corpo = linhas.map((cols) => cols.map(escapeCSV).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + corpo], { type: 'text/csv;charset=utf-8;' })
  baixarArquivo(blob, nomeArquivo)
}

export async function exportarXLSX<T>(itens: T[], colunas: ColunaExportavel<T>[], nomeArquivo: string, nomeAba = 'Dados') {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(nomeAba)

  sheet.columns = colunas.map((c) => ({ header: c.cabecalho, key: c.cabecalho, width: c.largura ?? 20 }))
  sheet.getRow(1).font = { bold: true }

  for (const item of itens) {
    sheet.addRow(Object.fromEntries(colunas.map((c) => [c.cabecalho, c.valor(item)])))
  }
  for (const c of colunas) {
    if (c.formatoNumerico) sheet.getColumn(c.cabecalho).numFmt = c.formatoNumerico
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  baixarArquivo(blob, nomeArquivo)
}
