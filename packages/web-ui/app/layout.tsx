import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Cabin',
  description: 'Intelligent Confluence documentation assistant',
  icons: {
    icon: [
      { rel: 'icon', url: '/favicon.png', type: 'image/png', sizes: '512x512' },
    ],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="h-screen" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        {children}
      </body>
    </html>
  )
}
