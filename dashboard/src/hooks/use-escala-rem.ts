'use client'

import { useEffect, useState } from 'react'

/** Escala atual da base de rem em relação aos 16px padrão (1 = normal; ~2 = TV 4K em modo TV).
 * Gráficos (SVG) têm medidas em px fixas que não acompanham o rem; multiplicar por esta escala
 * mantém texto, ícones e eixos proporcionais ao resto da tela. */
export function useEscalaRem(): number {
  const [escala, setEscala] = useState(1)

  useEffect(() => {
    const atualizar = () => {
      const base = parseFloat(getComputedStyle(document.documentElement).fontSize)
      setEscala(Number.isFinite(base) && base > 0 ? base / 16 : 1)
    }
    atualizar()
    window.addEventListener('resize', atualizar)
    // O modo TV muda a classe do <html> (e com ela o font-size) sem mudar a janela.
    const observador = new MutationObserver(atualizar)
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      window.removeEventListener('resize', atualizar)
      observador.disconnect()
    }
  }, [])

  return escala
}
