'use client'

import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'

interface AlertModalProps {
  isOpen: boolean
  title: string
  message: string
  type?: 'success' | 'error' | 'info'
  onClose: () => void
}

export default function AlertModal({
  isOpen,
  title,
  message,
  type = 'info',
  onClose
}: AlertModalProps) {
  if (!isOpen) return null

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle size={24} style={{ color: 'var(--success)' }} />
      case 'error':
        return <AlertCircle size={24} style={{ color: 'var(--error)' }} />
      default:
        return <Info size={24} style={{ color: 'var(--accent)' }} />
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-w-md w-full mx-4 ui-bg-secondary rounded-lg border ui-border-light ui-shadow-floating">
        <div className="flex items-center justify-between p-4 border-b ui-border-faint">
          <div className="flex items-center gap-3">
            {getIcon()}
            <h3 className="text-lg font-semibold ui-text-primary">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:ui-bg-primary transition-colors"
          >
            <X size={18} className="ui-text-secondary" />
          </button>
        </div>

        <div className="p-4">
          <p className="ui-text-primary mb-6">{message}</p>

          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="btn-primary"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}