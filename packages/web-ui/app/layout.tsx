import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'RAG Documentation Assistant',
  description: 'Intelligent Confluence documentation assistant',
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