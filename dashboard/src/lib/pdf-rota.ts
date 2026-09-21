interface ParadaPDF {
  ordem: number
  nome: string
  endereco: string | null
  cidade: string | null
  telefone: string | null
  latitude: number
  longitude: number
}

/** Link do Google Maps pra um ponto específico (não a rota inteira) — usa lat/lon em vez do
 * endereço em texto porque sempre existe e é preciso, mesmo quando o endereço vem incompleto
 * ou mal formatado do Google Places. */
function montarUrlPonto(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
}

interface ExportarRotaPDFInput {
  nomeRota: string
  descricao?: string | null
  pontoPartida?: string | null
  paradas: ParadaPDF[]
  urlGoogleMaps: string
}

const MARGEM_ESQUERDA = 14
const LIMITE_INFERIOR = 280

/** Gera e baixa um PDF com a listagem ordenada de paradas de uma rota — pensado pra levar
 * impresso ou consultar offline durante a visita, já que o link do Google Maps sozinho
 * depende de internet/GPS o tempo todo. */
export async function exportarRotaPDF({ nomeRota, descricao, pontoPartida, paradas, urlGoogleMaps }: ExportarRotaPDFInput) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  let y = 18

  const quebrarPagina = (alturaNecessaria: number) => {
    if (y + alturaNecessaria > LIMITE_INFERIOR) {
      doc.addPage()
      y = 18
    }
  }

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(nomeRota, MARGEM_ESQUERDA, y)
  y += 8

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100)
  if (pontoPartida) {
    doc.text(`Ponto de partida: ${pontoPartida}`, MARGEM_ESQUERDA, y)
    y += 6
  }
  if (descricao) {
    const linhas = doc.splitTextToSize(descricao, 180)
    doc.text(linhas, MARGEM_ESQUERDA, y)
    y += linhas.length * 5 + 2
  }

  y += 2
  doc.setDrawColor(200)
  doc.line(MARGEM_ESQUERDA, y, 196, y)
  y += 8

  for (const parada of paradas) {
    quebrarPagina(14)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(0)
    doc.text(`${parada.ordem}. ${parada.nome}`, MARGEM_ESQUERDA, y)
    y += 5

    const detalhe = [parada.cidade, parada.endereco, parada.telefone].filter(Boolean).join(' · ')
    if (detalhe) {
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(90)
      const linhas = doc.splitTextToSize(detalhe, 180)
      quebrarPagina(linhas.length * 4.5)
      doc.text(linhas, MARGEM_ESQUERDA, y)
      y += linhas.length * 4.5
    }

    quebrarPagina(5)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(37, 99, 235)
    doc.textWithLink('Abrir endereço no Google Maps', MARGEM_ESQUERDA, y, {
      url: montarUrlPonto(parada.latitude, parada.longitude),
    })
    y += 9
  }

  quebrarPagina(10)
  y += 2
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(37, 99, 235)
  doc.textWithLink('Abrir rota completa no Google Maps (todas as paradas em sequência)', MARGEM_ESQUERDA, y, {
    url: urlGoogleMaps,
  })

  const nomeArquivo = `${nomeRota.replace(/[^\w\-]+/g, '_')}.pdf`
  doc.save(nomeArquivo)
}
