'use client'

import { useEffect, useMemo, useState } from 'react'
import { Settings, Save, X } from 'lucide-react'

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
}

interface SettingsDrawerProps {
  isOpen: boolean
  onClose: () => void
  settings: SettingsData
  onSave: (settings: SettingsData) => void | Promise<void>
}

export default function SettingsDrawer({ isOpen, onClose, settings, onSave }: SettingsDrawerProps) {
  const [formData, setFormData] = useState<SettingsData>(settings)
  const [llmModels, setLlmModels] = useState<string[]>([])
  const [llmModelsLoading, setLlmModelsLoading] = useState(false)
  const [llmModelsError, setLlmModelsError] = useState<string | null>(null)
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([])
  const [embeddingModelsLoading, setEmbeddingModelsLoading] = useState(false)
  const [embeddingModelsError, setEmbeddingModelsError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setFormData(settings)
    }
  }, [settings, isOpen])

  const buildModelsUrl = (baseUrl: string) => {
    if (!baseUrl) return null
    const trimmed = baseUrl.trim().replace(/\/$/, '')
    return `${trimmed}/models`
  }

  useEffect(() => {
    if (!isOpen) return
    const endpoint = buildModelsUrl(formData.llmBaseUrl)
    if (!endpoint) {
      setLlmModels([])
      setLlmModelsError(null)
      return
    }
    let cancelled = false
    setLlmModelsLoading(true)
    setLlmModelsError(null)
    fetch(endpoint)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const json = await res.json()
        return Array.isArray(json?.data)
          ? json.data.map((item: any) => item?.id).filter(Boolean)
          : []
      })
      .then((models) => {
        if (cancelled) return
        setLlmModels(models)
        if (models.length && !models.includes(formData.llmModel)) {
          setFormData(prev => ({ ...prev, llmModel: models[0] }))
        }
      })
      .catch((error: any) => {
        if (cancelled) return
        setLlmModels([])
        setLlmModelsError(error?.message || 'Failed to load models')
      })
      .finally(() => {
        if (!cancelled) setLlmModelsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [formData.llmBaseUrl, isOpen, formData.llmModel])

  useEffect(() => {
    if (!isOpen) return
    const endpoint = buildModelsUrl(formData.embeddingBaseUrl)
    if (!endpoint) {
      setEmbeddingModels([])
      setEmbeddingModelsError(null)
      return
    }
    let cancelled = false
    setEmbeddingModelsLoading(true)
    setEmbeddingModelsError(null)
    fetch(endpoint)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const json = await res.json()
        return Array.isArray(json?.data)
          ? json.data.map((item: any) => item?.id).filter(Boolean)
          : []
      })
      .then((models) => {
        if (cancelled) return
        setEmbeddingModels(models)
        if (models.length && !models.includes(formData.embeddingModel)) {
          setFormData(prev => ({ ...prev, embeddingModel: models[0] }))
        }
      })
      .catch((error: any) => {
        if (cancelled) return
        setEmbeddingModels([])
        setEmbeddingModelsError(error?.message || 'Failed to load models')
      })
      .finally(() => {
        if (!cancelled) setEmbeddingModelsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [formData.embeddingBaseUrl, isOpen, formData.embeddingModel])

  const handleSave = async () => {
    await onSave(formData)
    onClose()
  }

  const handleInputChange = (field: keyof SettingsData, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const llmModelOptions = useMemo(() => {
    if (!formData.llmModel) return llmModels
    if (llmModels.includes(formData.llmModel)) return llmModels
    return [formData.llmModel, ...llmModels]
  }, [llmModels, formData.llmModel])

  const embeddingModelOptions = useMemo(() => {
    if (!formData.embeddingModel) return embeddingModels
    if (embeddingModels.includes(formData.embeddingModel)) return embeddingModels
    return [formData.embeddingModel, ...embeddingModels]
  }, [embeddingModels, formData.embeddingModel])

  if (!isOpen) return null

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel fixed right-0 top-0 h-full w-full max-w-2xl flex flex-col">
        {/* Header */}
        <div className="drawer-header flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <h2 className="drawer-title">
            <Settings className="w-5 h-5 ui-text-secondary" />
            Settings
          </h2>
          <button onClick={onClose} className="btn-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 min-h-0">
          {/* LLM Provider */}
          <div className="form-section first:pt-0">
            <h3 className="form-section-title ui-text-secondary text-sm uppercase tracking-wide">LLM Provider</h3>
            <div className="space-y-4">
              <div className="form-group">
                <label className="label-base">LLM Base URL</label>
                <input
                  type="text"
                  value={formData.llmBaseUrl}
                  onChange={(e) => handleInputChange('llmBaseUrl', e.target.value)}
                  className="input-base"
                />
              </div>
              <div className="form-group">
                <label className="label-base">Chat Model</label>
                <select
                  value={formData.llmModel}
                  onChange={(e) => handleInputChange('llmModel', e.target.value)}
                  className="input-base"
                >
                  {llmModelOptions.length > 0 ? (
                    llmModelOptions.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))
                  ) : (
                    <option value={formData.llmModel}>{formData.llmModel || 'Specify model ID'}</option>
                  )}
                </select>
                {llmModelsLoading && (
                  <p className="text-xs ui-text-secondary">
                    Loading models from provider…
                  </p>
                )}
                {llmModelsError && (
                  <p className="text-xs" style={{ color: 'var(--accent)' }}>
                    {llmModelsError}
                  </p>
                )}
              </div>
              <div className="form-group">
                <label className="label-base">Temperature: {formData.temperature}</label>
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

          {/* Embedding Provider */}
          <div className="form-section pt-6 first:pt-0">
            <h3 className="form-section-title ui-text-secondary text-sm uppercase tracking-wide">Embedding Provider</h3>
            <div className="space-y-4">
              <div className="form-group">
                <label className="label-base">Embedding Base URL</label>
                <input
                  type="text"
                  value={formData.embeddingBaseUrl}
                  onChange={(e) => handleInputChange('embeddingBaseUrl', e.target.value)}
                  className="input-base"
                />
              </div>
              <div className="form-group">
                <label className="label-base">Embedding Model</label>
                <select
                  value={formData.embeddingModel}
                  onChange={(e) => handleInputChange('embeddingModel', e.target.value)}
                  className="input-base"
                >
                  {embeddingModelOptions.length > 0 ? (
                    embeddingModelOptions.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))
                  ) : (
                    <option value={formData.embeddingModel}>{formData.embeddingModel || 'Specify model ID'}</option>
                  )}
                </select>
                {embeddingModelsLoading && (
                  <p className="text-xs ui-text-secondary">
                    Loading embedding models…
                  </p>
                )}
                {embeddingModelsError && (
                  <p className="text-xs" style={{ color: 'var(--accent)' }}>
                    {embeddingModelsError}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Vector Database */}
          <div className="form-section pt-6 first:pt-0">
            <h3 className="form-section-title">Vector Database</h3>
            <div className="space-y-4">
              <div className="form-group">
                <label className="label-base">Chroma Host</label>
                <input
                  type="text"
                  value={formData.chromaHost}
                  onChange={(e) => handleInputChange('chromaHost', e.target.value)}
                  className="input-base"
                />
              </div>
              <div className="form-group">
                <label className="label-base">Chroma Port</label>
                <input
                  type="number"
                  value={formData.chromaPort}
                  onChange={(e) => handleInputChange('chromaPort', parseInt(e.target.value))}
                  className="input-base"
                />
              </div>
            </div>
          </div>

          {/* Retrieval Settings */}
          <div className="form-section">
            <h3 className="form-section-title">Retrieval Settings</h3>
            <div className="space-y-4">
              <div className="form-group">
                <label className="label-base">Final Passages: {formData.finalPassages}</label>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={formData.finalPassages}
                  onChange={(e) => handleInputChange('finalPassages', parseInt(e.target.value))}
                  className="w-full"
                />
              </div>
              <div className="form-group">
                <label className="label-base">Cosine Floor</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={formData.cosineFloor}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value)
                    handleInputChange('cosineFloor', Number.isNaN(value) ? 0 : value)
                  }}
                  className="input-base"
                />
              </div>
              <div className="form-group">
                <label className="label-base">Min Keyword Overlap</label>
                <input
                  type="number"
                  min="0"
                  value={formData.minKeywordOverlap}
                  onChange={(e) => {
                    const value = parseInt(e.target.value)
                    handleInputChange('minKeywordOverlap', Number.isNaN(value) ? 0 : value)
                  }}
                  className="input-base"
                />
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="rm3Toggle"
                  checked={formData.useRm3}
                  onChange={(e) => handleInputChange('useRm3', e.target.checked)}
                  className="mr-2"
                />
                <label htmlFor="rm3Toggle" className="label-inline">
                  Enable RM3 Expansion
                </label>
              </div>
            </div>
          </div>

          {/* Reranker */}
          <div className="form-section">
            <h3 className="form-section-title">Reranker</h3>
            <div className="space-y-4">
              <div className="form-group">
                <label className="label-base">Sidecar URL</label>
                <input
                  type="text"
                  value={formData.rerankerUrl}
                  onChange={(e) => handleInputChange('rerankerUrl', e.target.value)}
                  className="input-base"
                />
              </div>
              <div className="form-group">
                <label className="label-base">Sidecar Port</label>
                <input
                  type="number"
                  value={formData.rerankerPort}
                  onChange={(e) => {
                    const value = parseInt(e.target.value)
                    handleInputChange('rerankerPort', Number.isNaN(value) ? 0 : value)
                  }}
                  className="input-base"
                />
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="rerankerEnabled"
                  checked={formData.useReranker}
                  onChange={(e) => handleInputChange('useReranker', e.target.checked)}
                  className="mr-2"
                />
                <label htmlFor="rerankerEnabled" className="label-inline">
                  Use Docker reranker
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="rerankerFallback"
                  checked={formData.allowRerankerFallback}
                  onChange={(e) => handleInputChange('allowRerankerFallback', e.target.checked)}
                  className="mr-2"
                />
                <label htmlFor="rerankerFallback" className="label-inline">
                  Allow heuristic fallback
                </label>
              </div>
            </div>
          </div>

          {/* Logging */}
          <div className="form-section">
            <h3 className="form-section-title">Logging & Diagnostics</h3>
            <div className="form-group">
              <label className="label-base">Log Level</label>
              <select
                value={formData.logLevel}
                onChange={(e) => handleInputChange('logLevel', e.target.value)}
                className="input-base"
              >
                {['DEBUG', 'INFO', 'WARN', 'ERROR'].map(level => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="p-4 border-t ui-border-faint flex-shrink-0">
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
