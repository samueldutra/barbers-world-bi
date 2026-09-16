/** Monta o link "wa.me" a partir de um telefone brasileiro em qualquer formatação
 * ((44) 99999-9999, com/sem +55 etc.) — abre o WhatsApp no celular ou o WhatsApp Web,
 * dependendo de onde for clicado. Retorna null se não parecer um número válido. */
export function linkWhatsapp(telefone: string | null | undefined): string | null {
  if (!telefone) return null

  const digitos = telefone.replace(/\D/g, '')
  if (digitos.length < 10) return null

  // DDD + número (10 ou 11 dígitos) sem código do país — assume Brasil (+55).
  const comCodigoPais = digitos.length <= 11 ? `55${digitos}` : digitos

  return `https://wa.me/${comCodigoPais}`
}
