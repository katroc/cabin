'use client'

import { X } from 'lucide-react'
import { SettingsPage } from './settings/SettingsPage'
import { ExtendedSettingsData } from './settings/SettingsProvider'

interface SettingsData {
  llmBaseUrl: string
  llmModel: string
  embeddingBaseUrl: string
  embeddingModel: string
  temperature: number
  chromaHost: string
  chromaPort: number
  finalPassages: number
  cosineFloor: number
  minKeywordOverlap: number
  useReranker: boolean
  allowRerankerFallback: boolean
  useRm3: boolean
  rerankerUrl: string
  rerankerPort: number
  logLevel: string
  maxMemoryMessages: number
  maxTokens: number
  streamingMaxTokens: number
  rephrasingMaxTokens: number
}

interface SettingsDrawerProps {
  isOpen: boolean
  onClose: () => void
  settings: SettingsData
  onSave: (settings: SettingsData) => void | Promise<void>
}

export default function SettingsDrawer({ isOpen, onClose, settings, onSave }: SettingsDrawerProps) {
  if (!isOpen) return null

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel fixed right-0 top-0 h-full w-full max-w-6xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="drawer-header flex-shrink-0">
          <h2 className="drawer-title">
            Settings
          </h2>
          <button onClick={onClose} className="btn-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Settings Content */}
        <div className="flex-1 min-h-0">
          <SettingsPage />
        </div>
      </div>
    </div>
  )
}
