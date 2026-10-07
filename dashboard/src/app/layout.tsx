import type { Metadata } from "next";
import { ThemeProvider } from "@/contexts/theme-context";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Barbers World BI",
  description: "Business Intelligence da Barbers World",
};

// Roda antes da hidratação: aplica a classe "dark" conforme a preferência salva ou o
// tema do aparelho, evitando o flash de tela clara. Mantém a mesma regra do ThemeProvider.
const SCRIPT_TEMA = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||((t!=='light')&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
