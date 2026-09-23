/** Constantes compartilhadas entre Mapeamento de Leads e Rotas (módulo Prospecção). */

// Maringá, PR — geocodificado via Nominatim. Ajustável na tela pelo campo de endereço.
export const CENTRO_PADRAO = { lat: -23.425269, lon: -51.9382078 }
export const NOME_CENTRO_PADRAO = 'Barbers World (Maringá, PR)'
export const ENDERECO_PADRAO = 'Maringá, PR'

// O link de rota do Google Maps aceita no máximo ~25 pontos (origem + destino + waypoints).
export const MAX_PARADAS_ROTA = 23
