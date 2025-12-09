'use client'

import { X } from 'lucide-react'
import { SettingsPage } from './settings/SettingsPage'

interface SettingsDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsDrawer({ isOpen, onClose }: SettingsDrawerProps) {
  if (!isOpen) return null

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel fixed right-0 top-0 h-full w-full max-w-5xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="drawer-header flex-shrink-0">
          <h2 className="drawer-title">
            Settings
          </h2>
          <button onClick={onClose} className="btn-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Settings Content - Uses SettingsProvider context internally */}
        <div className="flex-1 min-h-0">
          <SettingsPage />
        </div>
      </div>
    </div>
  )
}
