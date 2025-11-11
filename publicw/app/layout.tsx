import type { Metadata } from 'next'
import './globals.css'

import PublicSessionProvider from '@/components/PublicSessionProvider'

export const metadata: Metadata = {
  title: 'PRIS COM',
  description: 'Transport persoane • Rezervări online • Confort și siguranță',
  icons: {
    icon: '/sigla.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro">
      <body>
        <PublicSessionProvider>{children}</PublicSessionProvider>
      </body>
    </html>
  )
}
