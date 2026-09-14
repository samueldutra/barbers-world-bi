'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Theme = 'light' | 'dark' | 'system'

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  isLoading: boolean
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)
const SYSTEM_MEDIA_QUERY = '(prefers-color-scheme: dark)'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const localTheme = localStorage.getItem('theme') as Theme | null
        if (localTheme === 'light' || localTheme === 'dark' || localTheme === 'system') {
          setThemeState(localTheme)
          applyTheme(localTheme)
          return
        }

        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('theme_preference')
            .eq('id', user.id)
            .single()

          const preference = (profile as { theme_preference?: string } | null)?.theme_preference
          if (preference === 'light' || preference === 'dark') {
            setThemeState(preference)
            applyTheme(preference)
            return
          }
        }

        setThemeState('system')
        applyTheme('system')
      } catch (error) {
        console.error('Erro ao carregar tema:', error)
        setThemeState('system')
        applyTheme('system')
      } finally {
        setIsLoading(false)
      }
    }

    loadTheme()
  }, [supabase])

  const applyTheme = (newTheme: Theme) => {
    const root = document.documentElement
    const resolvedTheme = newTheme === 'system'
      ? (window.matchMedia(SYSTEM_MEDIA_QUERY).matches ? 'dark' : 'light')
      : newTheme

    if (resolvedTheme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }

  useEffect(() => {
    if (theme !== 'system') return
    const media = window.matchMedia(SYSTEM_MEDIA_QUERY)
    const handleChange = () => applyTheme('system')
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [theme])

  const setTheme = async (newTheme: Theme) => {
    setThemeState(newTheme)
    applyTheme(newTheme)
    localStorage.setItem('theme', newTheme)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user && (newTheme === 'light' || newTheme === 'dark')) {
        await supabase.from('user_profiles').update({ theme_preference: newTheme }).eq('id', user.id)
      }
    } catch (error) {
      console.error('Erro ao salvar preferência de tema:', error)
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isLoading }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
