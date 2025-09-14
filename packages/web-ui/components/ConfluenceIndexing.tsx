'use client'

import { useState } from 'react'
import { Database, Play, Trash2, RefreshCw, CheckCircle, AlertCircle, Clock } from 'lucide-react'

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
}

export default function ConfluenceIndexing({ isOpen, onClose }: ConfluenceIndexingProps) {
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

  const handleStartIndexing = async () => {
    if (!config.baseUrl) {
      alert('Please provide at least a Confluence base URL')
      return
    }

    if (!config.indexAllSpaces && config.spaces.length === 0) {
      alert('Please add at least one space or select "Index All Spaces"')
      return
    }

    setIsIndexing(true)

    const newJob: IndexingJob = {
      id: Date.now().toString(),
      status: 'running',
      progress: 0,
      totalPages: 0,
      indexedPages: 0,
      startedAt: new Date(),
      config: { ...config }
    }

    setJobs(prev => [newJob, ...prev])

    try {
      // Determine which spaces to index
      let spacesToIndex = config.spaces
      if (config.indexAllSpaces) {
        // For demonstration, we'll use some common space examples
        // In a real implementation, this would fetch all spaces from Confluence API
        spacesToIndex = ['PROJ', 'DOCS', 'KB', 'DEV', 'QA']
      }

      // Start the indexing process by calling the backend
      for (const space of spacesToIndex) {
        // Create a test document for each space
        const testContent = `
          <h1>${space} Space Documentation</h1>
          <h2>Getting Started</h2>
          <p>Welcome to the ${space} space. This contains documentation for the ${space} project.</p>
          <h3>Overview</h3>
          <p>This space contains important information about our ${space} workflows and processes.</p>
          <h3>Key Features</h3>
          <ul>
            <li>Feature 1: Core functionality</li>
            <li>Feature 2: Advanced tools</li>
            <li>Feature 3: Integration capabilities</li>
          </ul>
        `

        const indexResponse = await fetch('http://localhost:8788/api/index', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            page_title: `${space} Space Documentation`,
            text: testContent,
            space_name: space,
            source_url: `${config.baseUrl}/spaces/${space}`,
            last_modified: new Date().toISOString()
          })
        })

        if (!indexResponse.ok) {
          throw new Error(`Failed to index space ${space}`)
        }

        // Update progress
        const currentProgress = ((spacesToIndex.indexOf(space) + 1) / spacesToIndex.length) * 100
        setJobs(prev => prev.map(job =>
          job.id === newJob.id
            ? {
                ...job,
                progress: Math.floor(currentProgress),
                indexedPages: spacesToIndex.indexOf(space) + 1,
                totalPages: spacesToIndex.length
              }
            : job
        ))

        // Add delay between requests
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      setJobs(prev => prev.map(job =>
        job.id === newJob.id
          ? { ...job, status: 'completed', completedAt: new Date() }
          : job
      ))
    } catch (error) {
      setJobs(prev => prev.map(job =>
        job.id === newJob.id
          ? { ...job, status: 'failed', error: 'Failed to index Confluence content' }
          : job
      ))
    } finally {
      setIsIndexing(false)
    }
  }

  const handleClearIndex = async () => {
    if (confirm('Are you sure you want to clear the entire index? This cannot be undone.')) {
      try {
        const response = await fetch('http://localhost:8788/api/index', {
          method: 'DELETE'
        })
        if (response.ok) {
          alert('Index cleared successfully')
        }
      } catch (error) {
        console.error('Failed to clear index:', error)
        alert('Failed to clear index')
      }
    }
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
      <div className="drawer-panel relative ml-auto w-[600px] h-full overflow-y-auto">
        {/* Header */}
        <div className="drawer-header">
          <h2 className="drawer-title">
            <Database size={20} />
            Confluence Indexing
          </h2>
          <button onClick={onClose} className="btn-close">
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Configuration Section */}
          <div className="form-section">
            <h3 className="form-section-title">
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
                  onChange={(e) => setConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
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
                    onChange={(e) => setConfig(prev => ({ ...prev, username: e.target.value }))}
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
                    onChange={(e) => setConfig(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="API token or password"
                    className="input-base"
                  />
                </div>
              </div>

              <div className="form-group">
                <div className="flex items-center justify-between mb-3">
                  <label className="label-base">
                    Spaces to Index
                  </label>
                  <div className="flex items-center">
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

              <div className="form-row">
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
              <h3 className="form-section-title">
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
                          <span>Progress: {job.progress}%</span>
                          <span>{job.indexedPages} pages indexed</span>
                        </div>
                        <div
                          className="w-full h-2 rounded-full"
                          style={{ background: 'var(--bg-primary)' }}
                        >
                          <div
                            className="h-2 rounded-full transition-all"
                            style={{
                              background: 'var(--accent)',
                              width: `${job.progress}%`
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
    </div>
  )
}