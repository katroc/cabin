'use client'

import { useEffect } from 'react'
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react'
import { useToast } from './ToastProvider'

export function Toast() {
  const { toasts, removeToast } = useToast()

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[70] space-y-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  )
}

interface ToastItemProps {
  toast: {
    id: string
    message: string
    type: 'success' | 'error' | 'info' | 'warning'
  }
  onRemove: (id: string) => void
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onRemove(toast.id)
    }, 4000)

    return () => clearTimeout(timer)
  }, [toast.id, onRemove])

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircle size={18} style={{ color: 'var(--success)' }} />
      case 'error':
        return <AlertCircle size={18} style={{ color: 'var(--error)' }} />
      case 'warning':
        return <AlertTriangle size={18} style={{ color: 'var(--warning)' }} />
      default:
        return <Info size={18} style={{ color: 'var(--accent)' }} />
    }
  }

  const getBorderColor = () => {
    switch (toast.type) {
      case 'success':
        return 'var(--success)'
      case 'error':
        return 'var(--error)'
      case 'warning':
        return 'var(--warning)'
      default:
        return 'var(--accent)'
    }
  }

  return (
    <div
      className="flex items-center gap-3 p-4 rounded-lg border ui-bg-secondary ui-shadow-floating animate-in slide-in-from-right-2 fade-in duration-300"
      style={{ borderColor: getBorderColor() }}
    >
      {getIcon()}
      <p className="flex-1 ui-text-primary text-sm">{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className="p-1 rounded-lg hover:ui-bg-primary transition-colors"
      >
        <X size={16} className="ui-text-secondary" />
      </button>
    </div>
  )
}