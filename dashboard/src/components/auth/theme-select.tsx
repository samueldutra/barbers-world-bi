'use client'

import { Moon, Sun, Monitor } from 'lucide-react'
import { useTheme } from '@/contexts/theme-context'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type ThemeValue = 'light' | 'dark' | 'system'

export function ThemeSelect() {
  const { theme, setTheme, isLoading } = useTheme()

  return (
    <Select value={theme} onValueChange={(value) => setTheme(value as ThemeValue)}>
      <SelectTrigger className="w-full" aria-label="Selecionar tema" disabled={isLoading}>
        <SelectValue placeholder="Tema" />
      </SelectTrigger>
      <SelectContent className="rounded-xl">
        <SelectItem value="system" className="rounded-lg">
          <span className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-muted-foreground" />
            Sistema
          </span>
        </SelectItem>
        <SelectItem value="dark" className="rounded-lg">
          <span className="flex items-center gap-2">
            <Moon className="h-4 w-4 text-muted-foreground" />
            Modo Escuro
          </span>
        </SelectItem>
        <SelectItem value="light" className="rounded-lg">
          <span className="flex items-center gap-2">
            <Sun className="h-4 w-4 text-muted-foreground" />
            Modo Claro
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  )
}
