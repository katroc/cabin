'use client'

import { useState } from 'react'
import { Settings, X, Save } from 'lucide-react'

interface SettingsData {
  // LLM Configuration
  llmBaseUrl: string
  embeddingBaseUrl: string
  model: string
  temperature: number

  // Vector Database
  chromaHost: string
  chromaPort: number

  // RAG Pipeline
  topK: number
  relevanceThreshold: number
  useOptimizedPipeline: boolean
  enableIntentProcessing: boolean
}

interface SettingsDrawerProps {
  isOpen: boolean
  onClose: () => void
  settings: SettingsData
  onSave: (settings: SettingsData) => void
}

export default function SettingsDrawer({ isOpen, onClose, settings, onSave }: SettingsDrawerProps) {
  const [formData, setFormData] = useState<SettingsData>(settings)

  const handleSave = () => {
    onSave(formData)
    onClose()
  }

  const handleInputChange = (field: keyof SettingsData, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel relative ml-auto w-96 h-full overflow-y-auto">
        {/* Header */}
        <div className="drawer-header">
          <h2 className="drawer-title">
            <Settings size={20} />
            Settings
          </h2>
          <button onClick={onClose} className="btn-close">
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* LLM Configuration */}
          <div className="form-section">
            <h3 className="form-section-title">
              LLM Configuration
            </h3>
            <div className="space-y-4">
              <div className="form-group">
                <label className="label-base">
                  LLM Base URL
                </label>
                <input
                  type="text"
                  value={formData.llmBaseUrl}
                  onChange={(e) => handleInputChange('llmBaseUrl', e.target.value)}
                  className="input-base"
                />
              </div>
              <div className="form-group">
                <label className="label-base">
                  Embedding Base URL
                </label>
                <input
                  type="text"
                  value={formData.embeddingBaseUrl}
                  onChange={(e) => handleInputChange('embeddingBaseUrl', e.target.value)}
                  className="input-base"
                />
              </div>
              <div className="form-group">
                <label className="label-base">
                  Model
                </label>
                <input
                  type="text"
                  value={formData.model}
                  onChange={(e) => handleInputChange('model', e.target.value)}
                  className="input-base"
                />
              </div>
              <div className="form-group">
                <label className="label-base">
                  Temperature: {formData.temperature}
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={formData.temperature}
                  onChange={(e) => handleInputChange('temperature', parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
          </div>


          {/* Vector Database */}
          <div className="form-section">
            <h3 className="form-section-title">
              Vector Database
            </h3>
            <div className="space-y-4">
              <div className="form-group">
                <label className="label-base">
                  Chroma Host
                </label>
                <input
                  type="text"
                  value={formData.chromaHost}
                  onChange={(e) => handleInputChange('chromaHost', e.target.value)}
                  className="input-base"
                />
              </div>
              <div className="form-group">
                <label className="label-base">
                  Chroma Port
                </label>
                <input
                  type="number"
                  value={formData.chromaPort}
                  onChange={(e) => handleInputChange('chromaPort', parseInt(e.target.value))}
                  className="input-base"
                />
              </div>
            </div>
          </div>

          {/* RAG Pipeline */}
          <div className="form-section">
            <h3 className="form-section-title">
              RAG Pipeline
            </h3>
            <div className="space-y-4">
              <div className="form-group">
                <label className="label-base">
                  Top K Results: {formData.topK}
                </label>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={formData.topK}
                  onChange={(e) => handleInputChange('topK', parseInt(e.target.value))}
                  className="w-full"
                />
              </div>
              <div className="form-group">
                <label className="label-base">
                  Relevance Threshold: {formData.relevanceThreshold}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={formData.relevanceThreshold}
                  onChange={(e) => handleInputChange('relevanceThreshold', parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="optimizedPipeline"
                  checked={formData.useOptimizedPipeline}
                  onChange={(e) => handleInputChange('useOptimizedPipeline', e.target.checked)}
                  className="mr-2"
                />
                <label htmlFor="optimizedPipeline" className="label-inline">
                  Use Optimized Pipeline
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="intentProcessing"
                  checked={formData.enableIntentProcessing}
                  onChange={(e) => handleInputChange('enableIntentProcessing', e.target.checked)}
                  className="mr-2"
                />
                <label htmlFor="intentProcessing" className="label-inline">
                  Enable Intent Processing
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t" style={{ borderColor: 'var(--border-faint)' }}>
          <button
            onClick={handleSave}
            className="btn-primary flex-1 w-full"
          >
            <Save size={16} />
            Save Settings
          </button>
        </div>
      </div>
    </div>
  )
}