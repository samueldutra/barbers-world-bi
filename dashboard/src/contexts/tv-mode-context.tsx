'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

interface TvModeContextType {
  tvMode: boolean
  entrar: () => void
  sair: () => void
}

const TvModeContext = createContext<TvModeContextType | undefined>(undefined)

/** Modo TV (só o Dashboard liga): tela cheia, menu escondido (aparece ao encostar o mouse no
 * topo), interface escalada pela largura da tela e tela sempre acesa. A classe "tv-mode" no
 * <html> dispara o CSS de escala (globals.css). */
export function TvModeProvider({ children }: { children: React.ReactNode }) {
  const [tvMode, setTvMode] = useState(false)
  const estavaEmTelaCheia = useRef(false)

  const entrar = useCallback(() => {
    setTvMode(true)
    // Precisa rodar dentro do clique (gesto do usuário). Falhar (ex.: iOS) não impede o modo TV.
    document.documentElement.requestFullscreen?.().catch(() => {})
  }, [])

  const sair = useCallback(() => {
    setTvMode(false)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }, [])

  useEffect(() => {
    if (!tvMode) return
    const html = document.documentElement
    html.classList.add('tv-mode')

    const aoMudarTelaCheia = () => {
      if (document.fullscreenElement) {
        estavaEmTelaCheia.current = true
      } else if (estavaEmTelaCheia.current) {
        // Esc (ou o navegador) saiu da tela cheia: sai do modo TV junto.
        estavaEmTelaCheia.current = false
        setTvMode(false)
      }
    }
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTvMode(false)
    }
    document.addEventListener('fullscreenchange', aoMudarTelaCheia)
    document.addEventListener('keydown', aoTeclar)

    // Mantém a tela acesa (TV/monitor de parede não deve entrar em descanso).
    let wakeLock: WakeLockSentinel | null = null
    const pedirWakeLock = async () => {
      try {
        wakeLock = (await navigator.wakeLock?.request('screen')) ?? null
      } catch {
        wakeLock = null
      }
    }
    const aoVoltarVisivel = () => {
      if (document.visibilityState === 'visible') pedirWakeLock()
    }
    pedirWakeLock()
    document.addEventListener('visibilitychange', aoVoltarVisivel)

    return () => {
      html.classList.remove('tv-mode')
      document.removeEventListener('fullscreenchange', aoMudarTelaCheia)
      document.removeEventListener('keydown', aoTeclar)
      document.removeEventListener('visibilitychange', aoVoltarVisivel)
      wakeLock?.release().catch(() => {})
      estavaEmTelaCheia.current = false
    }
  }, [tvMode])

  const value = useMemo(() => ({ tvMode, entrar, sair }), [tvMode, entrar, sair])
  return <TvModeContext.Provider value={value}>{children}</TvModeContext.Provider>
}

export function useTvMode() {
  const context = useContext(TvModeContext)
  if (context === undefined) {
    throw new Error('useTvMode must be used within a TvModeProvider')
  }
  return context
}
