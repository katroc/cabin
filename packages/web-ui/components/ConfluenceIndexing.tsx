'use client'

import { useState } from 'react'
import { Database, Play, Trash2, RefreshCw, CheckCircle, AlertCircle, Clock, Wifi, ArrowLeft, X } from 'lucide-react'
import ConfirmationModal from './ConfirmationModal'
import AlertModal from './AlertModal'
import { useToast } from './ToastProvider'

interface ConfluenceConfig {
  baseUrl: string
  username: string
  password: string
  spaces: string[]
  indexAllSpaces: boolean
  maxPages: number
  includeAttachments: boolean
}

interface IndexingJob {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  totalPages: number
  indexedPages: number
  startedAt: Date
  completedAt?: Date
  error?: string
  config: ConfluenceConfig
}

interface ConfluenceIndexingProps {
  isOpen: boolean
  onClose: () => void
  onBack?: () => void
}

export default function ConfluenceIndexing({ isOpen, onClose, onBack }: ConfluenceIndexingProps) {
  const { addToast } = useToast()

  const [config, setConfig] = useState<ConfluenceConfig>({
    baseUrl: '',
    username: '',
    password: '',
    spaces: [],
    indexAllSpaces: false,
    maxPages: 1000,
    includeAttachments: false
  })

  const [spaceInput, setSpaceInput] = useState('')
  const [jobs, setJobs] = useState<IndexingJob[]>([])
  const [isIndexing, setIsIndexing] = useState(false)
  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'untested' | 'success' | 'failed'>('untested')
  const [showClearConfirmation, setShowClearConfirmation] = useState(false)
  const [showAlert, setShowAlert] = useState(false)
  const [alertConfig, setAlertConfig] = useState<{ title: string; message: string; type: 'success' | 'error' | 'info' } | null>(null)

  if (!isOpen) return null

  const handleAddSpace = () => {
    if (spaceInput.trim() && !config.spaces.includes(spaceInput.trim())) {
      setConfig(prev => ({
        ...prev,
        spaces: [...prev.spaces, spaceInput.trim()]
      }))
      setSpaceInput('')
    }
  }

  const handleRemoveSpace = (space: string) => {
    setConfig(prev => ({
      ...prev,
      spaces: prev.spaces.filter(s => s !== space)
    }))
  }

  const handleTestConnection = async () => {
    if (!config.baseUrl) {
      setAlertConfig({
        title: 'Missing URL',
        message: 'Please provide a Confluence base URL first.',
        type: 'info'
      })
      setShowAlert(true)
      return
    }

    setIsTestingConnection(true)
    setConnectionStatus('untested')

    try {
      const testResponse = await fetch('http://localhost:8788/api/data-sources/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_type: 'confluence',
          connection: {
            base_url: config.baseUrl,
            username: config.username || null,
            password: config.password || null
          }
        })
      })

      if (testResponse.ok) {
        const testData = await testResponse.json()
        setConnectionStatus(testData.success ? 'success' : 'failed')
      } else {
        setConnectionStatus('failed')
      }
    } catch (error) {
      console.error('Connection test failed:', error)
      setConnectionStatus('failed')
    } finally {
      setIsTestingConnection(false)
    }
  }

  const handleStartIndexing = async () => {
    if (!config.baseUrl) {
      alert('Please provide at least a Confluence base URL')
      return
    }

    setIsIndexing(true)

    try {
      // Determine which spaces to index
      let spacesToIndex = config.spaces
      if (config.indexAllSpaces) {
        // Discover all available spaces
        try {
          const discoveryResponse = await fetch('http://localhost:8788/api/data-sources/discover', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              source_type: 'confluence',
              connection: {
                base_url: config.baseUrl,
                username: config.username || null,
                password: config.password || null
              }
            })
          })

          if (discoveryResponse.ok) {
            const discoveryData = await discoveryResponse.json()
            spacesToIndex = discoveryData.sources.map((s: any) => s.id)
          } else {
            // Fallback to empty array if discovery fails
            spacesToIndex = []
          }
        } catch (error) {
          console.error('Failed to discover spaces:', error)
          spacesToIndex = []
        }
      }

      // Start the indexing job
      const indexingResponse = await fetch('http://localhost:8788/api/data-sources/index', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_type: 'confluence',
          connection: {
            base_url: config.baseUrl,
            username: config.username || null,
            password: config.password || null
          },
          source_ids: spacesToIndex,
          config: {
            max_items: config.maxPages,
            include_attachments: config.includeAttachments
          }
        })
      })

      if (!indexingResponse.ok) {
        throw new Error('Failed to start indexing job')
      }

      const indexingData = await indexingResponse.json()
      const jobId = indexingData.job_id

      // Create job entry
      const newJob: IndexingJob = {
        id: jobId,
        status: 'running',
        progress: 0,
        totalPages: 0,
        indexedPages: 0,
        startedAt: new Date(),
        config: { ...config }
      }

      setJobs(prev => [newJob, ...prev])

      // Poll for progress updates
      const pollProgress = async () => {
        try {
          const progressResponse = await fetch(`http://localhost:8788/api/data-sources/jobs/${jobId}`)

          if (progressResponse.ok) {
            const progressData = await progressResponse.json()

            setJobs(prev => prev.map(job =>
              job.id === jobId
                ? {
                    ...job,
                    status: progressData.status,
                    progress: progressData.total_items > 0
                      ? Math.min(100, Math.max(0, Math.floor((progressData.processed_items / progressData.total_items) * 100)))
                      : progressData.processed_items > 0 ? 50 : 0, // Show some progress even without total
                    totalPages: progressData.total_items,
                    indexedPages: progressData.processed_items,
                    error: progressData.error_message,
                    completedAt: progressData.completed_at ? new Date(progressData.completed_at) : undefined
                  }
                : job
            ))

            // Continue polling if still running
            if (progressData.status === 'running' || progressData.status === 'pending') {
              setTimeout(pollProgress, 2000) // Poll every 2 seconds
            } else {
              setIsIndexing(false)
            }
          } else {
            console.error('Failed to get progress update')
            setIsIndexing(false)
          }
        } catch (error) {
          console.error('Error polling progress:', error)
          setIsIndexing(false)
        }
      }

      // Start polling
      setTimeout(pollProgress, 1000)

    } catch (error) {
      console.error('Error starting indexing:', error)
      setAlertConfig({
        title: 'Indexing Failed',
        message: 'Failed to start indexing. Please check your configuration and try again.',
        type: 'error'
      })
      setShowAlert(true)
      setIsIndexing(false)
    }
  }

  const handleClearIndex = () => {
    setShowClearConfirmation(true)
  }

  const handleConfirmClearIndex = async () => {
    setShowClearConfirmation(false)
    try {
      const response = await fetch('http://localhost:8788/api/index', {
        method: 'DELETE'
      })
      if (response.ok) {
        addToast('The index has been cleared successfully.', 'success')
      } else {
        throw new Error('Failed to clear index')
      }
    } catch (error) {
      console.error('Failed to clear index:', error)
      setAlertConfig({
        title: 'Clear Failed',
        message: 'Failed to clear the index. Please try again.',
        type: 'error'
      })
      setShowAlert(true)
    }
  }

  const handleCancelClearIndex = () => {
    setShowClearConfirmation(false)
  }

  const handleCloseAlert = () => {
    setShowAlert(false)
    setAlertConfig(null)
  }

  const getStatusIcon = (status: IndexingJob['status']) => {
    switch (status) {
      case 'running':
        return <RefreshCw size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />
      case 'completed':
        return <CheckCircle size={16} style={{ color: 'var(--success)' }} />
      case 'failed':
        return <AlertCircle size={16} style={{ color: 'var(--error)' }} />
      default:
        return <Clock size={16} style={{ color: 'var(--text-muted)' }} />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel fixed left-0 top-0 h-full w-full max-w-2xl overflow-y-auto">
        {/* Header */}
        <div className="drawer-header ui-bg-secondary border-b ui-border-faint" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-3">
            {onBack && (
              <button onClick={onBack} className="btn-close">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="drawer-title ui-text-primary">
              <Database size={20} />
              Confluence Indexing
            </h2>
          </div>
          <button onClick={onClose} className="btn-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 divide-y divide-[color:var(--border-faint)]">
          {/* Configuration Section */}
          <div className="form-section pt-6 first:pt-0">
            <h3 className="form-section-title ui-text-secondary text-sm uppercase tracking-wide">
              Configuration
            </h3>

            <div className="space-y-4">
              <div className="form-group">
                <label className="label-base">
                  Confluence Base URL
                </label>
                <input
                  type="text"
                  value={config.baseUrl}
                  onChange={(e) => {
                    setConfig(prev => ({ ...prev, baseUrl: e.target.value }))
                    setConnectionStatus('untested')
                  }}
                  placeholder="https://yourcompany.atlassian.net/wiki"
                  className="input-base"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="label-base">
                    Username
                  </label>
                  <input
                    type="text"
                    value={config.username}
                    onChange={(e) => {
                      setConfig(prev => ({ ...prev, username: e.target.value }))
                      setConnectionStatus('untested')
                    }}
                    placeholder="user@company.com"
                    className="input-base"
                  />
                </div>
                <div className="form-group">
                  <label className="label-base">
                    API Token/Password
                  </label>
                  <input
                    type="password"
                    value={config.password}
                    onChange={(e) => {
                      setConfig(prev => ({ ...prev, password: e.target.value }))
                      setConnectionStatus('untested')
                    }}
                    placeholder="API token or password"
                    className="input-base"
                  />
                </div>
              </div>

              {/* Test Connection */}
              <div className="form-group">
                <button
                  onClick={handleTestConnection}
                  disabled={isTestingConnection || !config.baseUrl}
                  className="btn-secondary flex items-center gap-2"
                >
                  {isTestingConnection ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <Wifi size={16} />
                  )}
                  {isTestingConnection ? 'Testing...' : 'Test Connection'}
                </button>

                {connectionStatus !== 'untested' && (
                  <div className="flex items-center gap-2 mt-2 text-sm" style={{
                    color: connectionStatus === 'success' ? 'var(--success)' : 'var(--error)'
                  }}>
                    {connectionStatus === 'success' ? (
                      <>
                        <CheckCircle size={16} />
                        Connection successful
                      </>
                    ) : (
                      <>
                        <AlertCircle size={16} />
                        Connection failed
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="form-group">
                <div className="mb-3">
                  <label className="label-base">
                    Spaces to Index
                  </label>
                  <div className="mt-2 flex items-center">
                    <input
                      type="checkbox"
                      id="indexAllSpaces"
                      checked={config.indexAllSpaces}
                      onChange={(e) => setConfig(prev => ({ ...prev, indexAllSpaces: e.target.checked }))}
                      className="mr-2"
                    />
                    <label htmlFor="indexAllSpaces" className="label-inline">
                      Index All Spaces
                    </label>
                  </div>
                </div>
                {!config.indexAllSpaces && (
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={spaceInput}
                      onChange={(e) => setSpaceInput(e.target.value)}
                      placeholder="Space key (e.g., PROJ, DOCS)"
                      className="input-base flex-1"
                      onKeyPress={(e) => e.key === 'Enter' && handleAddSpace()}
                    />
                    <button
                      onClick={handleAddSpace}
                      className="btn-primary"
                    >
                      Add
                    </button>
                  </div>
                )}

                {config.indexAllSpaces && (
                  <div
                    className="text-sm p-3 rounded-lg"
                    style={{
                      background: 'var(--bg-tertiary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <div className="flex items-center mb-1">
                      <div
                        className="w-2 h-2 rounded-full mr-2"
                        style={{ background: 'var(--accent)' }}
                      />
                      All available spaces will be indexed
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      This will discover and index content from all accessible Confluence spaces
                    </div>
                  </div>
                )}

                {!config.indexAllSpaces && config.spaces.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {config.spaces.map((space) => (
                      <span key={space} className="tag">
                        {space}
                        <button
                          onClick={() => handleRemoveSpace(space)}
                          className="tag-remove"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="form-group">
                  <label className="label-base">
                    Max Pages: {config.maxPages}
                  </label>
                  <input
                    type="range"
                    min="100"
                    max="10000"
                    step="100"
                    value={config.maxPages}
                    onChange={(e) => setConfig(prev => ({ ...prev, maxPages: parseInt(e.target.value) }))}
                    className="w-full"
                  />
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="includeAttachments"
                    checked={config.includeAttachments}
                    onChange={(e) => setConfig(prev => ({ ...prev, includeAttachments: e.target.checked }))}
                    className="mr-2"
                  />
                  <label htmlFor="includeAttachments" className="label-inline">
                    Include Attachments
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleStartIndexing}
              disabled={isIndexing}
              className="btn-primary flex-1"
            >
              <Play size={16} />
              {isIndexing ? 'Indexing...' : 'Start Indexing'}
            </button>

            <button
              onClick={handleClearIndex}
              className="btn-secondary"
            >
              <Trash2 size={16} />
              Clear Index
            </button>
          </div>

          {/* Jobs History */}
          {jobs.length > 0 && (
            <div>
              <h3 className="form-section-title ui-text-secondary text-sm uppercase tracking-wide">
                Indexing History
              </h3>

              <div className="space-y-3">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="p-4 rounded-lg border"
                    style={{
                      background: 'var(--bg-tertiary)',
                      borderColor: 'var(--border)'
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(job.status)}
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          {job.config.indexAllSpaces
                            ? 'All Spaces'
                            : job.config.spaces.join(', ') || 'No specific spaces'
                          }
                        </span>
                      </div>
                      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        {job.startedAt.toLocaleString()}
                      </span>
                    </div>

                    {job.status === 'running' && (
                      <div className="mb-2">
                        <div className="flex justify-between text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                          <span>Progress: {Math.min(100, Math.max(0, job.progress || 0))}%</span>
                          <span>{job.indexedPages} pages indexed</span>
                        </div>
                        <div
                          className="w-full h-2 rounded-full overflow-hidden"
                          style={{ background: 'var(--bg-primary)' }}
                        >
                          <div
                            className="h-2 rounded-full transition-all"
                            style={{
                              background: 'var(--accent)',
                              width: `${Math.min(100, Math.max(0, job.progress || 0))}%`
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {job.error && (
                      <p className="text-sm mt-2" style={{ color: 'var(--error)' }}>
                        {job.error}
                      </p>
                    )}

                    {job.completedAt && (
                      <p className="text-sm mt-2" style={{ color: 'var(--success)' }}>
                        Completed at {job.completedAt.toLocaleString()}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={showClearConfirmation}
        title="Clear Index"
        message="Are you sure you want to clear the entire index? This action cannot be undone."
        confirmText="Clear Index"
        cancelText="Cancel"
        onConfirm={handleConfirmClearIndex}
        onCancel={handleCancelClearIndex}
        type="danger"
      />

      {alertConfig && (
        <AlertModal
          isOpen={showAlert}
          title={alertConfig.title}
          message={alertConfig.message}
          type={alertConfig.type}
          onClose={handleCloseAlert}
        />
      )}
    </div>
  )
}
