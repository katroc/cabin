import type { Metadata } from 'next'
import './globals.css'
import { ToastProvider } from '../components/ToastProvider'
import { Toast } from '../components/Toast'
import { UIPreferencesProvider } from '../components/contexts/UIPreferencesProvider'

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
        <UIPreferencesProvider>
          <ToastProvider>
            {children}
            <Toast />
          </ToastProvider>
        </UIPreferencesProvider>
      </body>
    </html>
  )
}
