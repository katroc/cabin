'use client'

import { useState, useCallback } from 'react'
import { Link, Plus, Trash2, Play, CheckCircle, AlertCircle, Clock, X, ArrowLeft, Globe } from 'lucide-react'

interface URLItem {
  id: string
  url: string
  status: 'pending' | 'valid' | 'invalid'
  error?: string
}

interface IndexingJob {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  totalUrls: number
  processedUrls: number
  startedAt: Date
  completedAt?: Date
  error?: string
}

interface URLIngestionIndexingProps {
  isOpen: boolean
  onClose: () => void
  onBack?: () => void
}

export default function URLIngestionIndexing({ isOpen, onClose, onBack }: URLIngestionIndexingProps) {
  const [urls, setUrls] = useState<URLItem[]>([])
  const [urlInput, setUrlInput] = useState('')
  const [jobs, setJobs] = useState<IndexingJob[]>([])
  const [isIndexing, setIsIndexing] = useState(false)

  if (!isOpen) return null

  const validateURL = (url: string): boolean => {
    try {
      const urlObj = new URL(url)
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:'
    } catch {
      return false
    }
  }

  const handleAddURL = useCallback(() => {
    const trimmedUrl = urlInput.trim()

    if (!trimmedUrl) return

    // Check for duplicates
    if (urls.some(item => item.url === trimmedUrl)) {
      return
    }

    const isValid = validateURL(trimmedUrl)

    const newUrl: URLItem = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      url: trimmedUrl,
      status: isValid ? 'valid' : 'invalid',
      error: isValid ? undefined : 'Invalid URL format'
    }

    setUrls(prev => [...prev, newUrl])
    setUrlInput('')
  }, [urlInput, urls])

  const handleRemoveURL = useCallback((id: string) => {
    setUrls(prev => prev.filter(item => item.id !== id))
  }, [])

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddURL()
    }
  }

  const handleStartIndexing = async () => {
    const validUrls = urls.filter(item => item.status === 'valid')

    if (validUrls.length === 0) {
      return
    }

    setIsIndexing(true)

    try {
      const urlList = validUrls.map(item => item.url)

      // Start indexing job
      const startResponse = await fetch('http://localhost:8788/api/data-sources/url_ingestion/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: urlList,
          max_items: 100
        })
      })

      if (!startResponse.ok) {
        throw new Error(`Indexing failed: ${startResponse.statusText}`)
      }

      const { job_id } = await startResponse.json()

      // Create job entry
      const newJob: IndexingJob = {
        id: job_id,
        status: 'running',
        progress: 0,
        totalUrls: validUrls.length,
        processedUrls: 0,
        startedAt: new Date()
      }

      setJobs(prev => [newJob, ...prev])

      // Poll for progress
      const pollInterval = setInterval(async () => {
        try {
          const progressResponse = await fetch(`http://localhost:8788/api/data-sources/url_ingestion/jobs/${job_id}`)

          if (!progressResponse.ok) {
            clearInterval(pollInterval)
            return
          }

          const progressData = await progressResponse.json()

          setJobs(prev => prev.map(job =>
            job.id === job_id
              ? {
                  ...job,
                  status: progressData.status,
                  progress: progressData.processed_items / progressData.total_items * 100 || 0,
                  processedUrls: progressData.processed_items || 0,
                  completedAt: progressData.status === 'completed' || progressData.status === 'failed'
                    ? new Date()
                    : undefined,
                  error: progressData.error_message
                }
              : job
          ))

          if (progressData.status === 'completed' || progressData.status === 'failed') {
            clearInterval(pollInterval)
            setIsIndexing(false)
            // Clear URLs on success
            if (progressData.status === 'completed') {
              setUrls([])
            }
          }
        } catch (error) {
          console.error('Error polling progress:', error)
          clearInterval(pollInterval)
          setIsIndexing(false)
        }
      }, 1000)

    } catch (error) {
      console.error('Failed to start indexing:', error)
      setIsIndexing(false)
    }
  }

  const validUrlCount = urls.filter(u => u.status === 'valid').length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative flex h-[90vh] w-full max-w-4xl flex-col rounded-xl border ui-bg-primary ui-border-light ui-shadow-elevated">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4 ui-border-light">
          <div className="flex items-center gap-3">
            {onBack && (
              <button onClick={onBack} className="btn-icon" aria-label="Back">
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="flex items-center gap-3">
              <Globe className="w-5 h-5 ui-text-secondary" />
              Add Web Pages
            </div>
          </div>
          <button onClick={onClose} className="btn-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* URL Input */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium ui-text-secondary">
              Add URLs to Index
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="https://example.com/page"
                className="flex-1 rounded-lg border px-4 py-2 text-base ui-bg-secondary ui-border-light ui-text-primary focus:border-[var(--accent)] focus:outline-none"
                disabled={isIndexing}
              />
              <button
                onClick={handleAddURL}
                disabled={!urlInput.trim() || isIndexing}
                className="btn-secondary flex items-center gap-2"
              >
                <Plus size={16} />
                Add
              </button>
            </div>
            <p className="mt-2 text-xs ui-text-muted">
              Press Enter or click Add to add URLs to the list
            </p>
          </div>

          {/* URL List */}
          {urls.length > 0 && (
            <div className="mb-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium ui-text-secondary">
                  URLs to Process ({validUrlCount} valid)
                </h3>
                <button
                  onClick={() => setUrls([])}
                  disabled={isIndexing}
                  className="text-xs ui-text-muted hover:ui-text-secondary"
                >
                  Clear all
                </button>
              </div>
              <div className="space-y-2">
                {urls.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 ui-bg-secondary ${
                      item.status === 'valid' ? 'ui-border-light' : 'border-red-500/30'
                    }`}
                  >
                    <div className="flex-shrink-0">
                      {item.status === 'valid' ? (
                        <CheckCircle className="text-green-500" size={18} />
                      ) : (
                        <AlertCircle className="text-red-500" size={18} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm ui-text-primary">{item.url}</p>
                      {item.error && (
                        <p className="text-xs text-red-500">{item.error}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveURL(item.id)}
                      disabled={isIndexing}
                      className="btn-icon"
                      aria-label="Remove URL"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleStartIndexing}
              disabled={isIndexing || validUrlCount === 0}
              className="btn-primary flex-1"
            >
              <Play size={16} />
              {isIndexing ? 'Indexing...' : `Index ${validUrlCount} URL${validUrlCount !== 1 ? 's' : ''}`}
            </button>
          </div>

          {/* Jobs History */}
          {jobs.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-medium ui-text-secondary">Indexing History</h3>
              <div className="space-y-3">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="rounded-lg border p-4 ui-bg-secondary ui-border-light"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {job.status === 'running' && (
                          <Clock className="animate-spin text-blue-500" size={16} />
                        )}
                        {job.status === 'completed' && (
                          <CheckCircle className="text-green-500" size={16} />
                        )}
                        {job.status === 'failed' && (
                          <AlertCircle className="text-red-500" size={16} />
                        )}
                        <span className="text-sm font-medium capitalize ui-text-primary">
                          {job.status}
                        </span>
                      </div>
                      <span className="text-xs ui-text-muted">
                        {job.startedAt.toLocaleTimeString()}
                      </span>
                    </div>

                    {job.status === 'running' && (
                      <div className="mb-2">
                        <div className="h-2 overflow-hidden rounded-full ui-bg-tertiary">
                          <div
                            className="h-full bg-[var(--accent)] transition-all duration-300"
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                        <p className="mt-1 text-xs ui-text-muted">
                          {job.processedUrls} of {job.totalUrls} URLs processed
                        </p>
                      </div>
                    )}

                    {job.status === 'completed' && (
                      <p className="text-xs text-green-600">
                        Successfully indexed {job.processedUrls} URLs
                      </p>
                    )}

                    {job.error && (
                      <p className="text-xs text-red-500">{job.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
