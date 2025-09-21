'use client'

import { useState, useCallback, useEffect } from 'react'
import { Upload, File, Trash2, Play, CheckCircle, AlertCircle, Clock, X, ArrowLeft, FolderUp, FileUp } from 'lucide-react'

interface UploadedFile {
  file: File
  id: string
  name: string
  size: number
  status: 'pending' | 'uploading' | 'uploaded' | 'failed'
  progress: number
  error?: string
}

interface IndexingJob {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  totalFiles: number
  processedFiles: number
  startedAt: Date
  completedAt?: Date
  error?: string
  uploadId?: string
}

interface FileUploadIndexingProps {
  isOpen: boolean
  onClose: () => void
  onBack?: () => void
}

export default function FileUploadIndexing({ isOpen, onClose, onBack }: FileUploadIndexingProps) {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [jobs, setJobs] = useState<IndexingJob[]>([])
  const [isIndexing, setIsIndexing] = useState(false)
  const [uploadId, setUploadId] = useState<string | null>(null)

  // Supported file types
  const supportedTypes = [
    '.pdf', '.docx', '.docm', '.md', '.markdown',
    '.html', '.htm', '.txt', '.text', '.log', '.csv'
  ]

  const isFileTypeSupported = (filename: string) => {
    const extension = filename.toLowerCase().match(/\.[^.]+$/)?.[0]
    return extension && supportedTypes.includes(extension)
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const addFiles = useCallback((files: File[]) => {
    try {
      const newFiles = files.map(file => ({
        file,
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        size: file.size,
        status: 'pending' as const,
        progress: 0
      }))

      // Filter out unsupported files and show warning
      const supportedFiles = newFiles.filter(f => isFileTypeSupported(f.file.name))
      const unsupportedFiles = newFiles.filter(f => !isFileTypeSupported(f.file.name))

      if (unsupportedFiles.length > 0) {
        setTimeout(() => {
          // Use a more user-friendly notification instead of alert
          console.warn(`${unsupportedFiles.length} files were skipped (unsupported format). Supported: ${supportedTypes.join(', ')}`)
        }, 100)
      }

      // Check file size (10MB limit)
      const validFiles = supportedFiles.filter(f => f.file.size <= 10 * 1024 * 1024)
      const oversizedFiles = supportedFiles.filter(f => f.file.size > 10 * 1024 * 1024)

      if (oversizedFiles.length > 0) {
        setTimeout(() => {
          // Use a more user-friendly notification instead of alert
          console.warn(`${oversizedFiles.length} files were skipped (over 10MB limit)`)
        }, 200)
      }

      if (validFiles.length > 0) {
        setUploadedFiles(prev => [...prev, ...validFiles])
      }
    } catch (error) {
      console.error('Error adding files:', error)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    addFiles(files)
  }, [addFiles])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files)
      addFiles(files)
    }
  }, [addFiles])

  const removeFile = (id: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== id))
  }

  const clearAllFiles = () => {
    setUploadedFiles([])
    setUploadId(null)
  }

  const uploadFiles = useCallback(async () => {
    if (uploadedFiles.length === 0) return

    setIsUploading(true)

    try {
      // Update file statuses to uploading
      setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'uploading' as const })))

      const formData = new FormData()
      uploadedFiles.forEach(({ file }) => {
        formData.append('files', file)
      })

      const response = await fetch('http://localhost:8788/api/files/upload', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()

      if (result.success) {
        setUploadId(result.upload_id)
        setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'uploaded' as const, progress: 100 })))
      } else {
        throw new Error(result.message || 'Upload failed')
      }
    } catch (error) {
      console.error('Upload failed:', error)
      const errorMessage = error instanceof Error ? error.message : 'Upload failed'
      setUploadedFiles(prev => prev.map(f => ({
        ...f,
        status: 'failed' as const,
        error: errorMessage
      })))
    } finally {
      setIsUploading(false)
    }
  }, [uploadedFiles])

  const startIndexing = useCallback(async () => {
    if (!uploadId) {
      await uploadFiles()
      return
    }

    setIsIndexing(true)

    try {
      const response = await fetch('http://localhost:8788/api/files/index', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          upload_path: uploadId,  // uploadId is already the full path
          config: {
            max_items: 1000
          }
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()

      const newJob: IndexingJob = {
        id: result.job_id,
        status: 'running',
        progress: 0,
        totalFiles: uploadedFiles.length,
        processedFiles: 0,
        startedAt: new Date(),
        uploadId
      }

      setJobs(prev => [newJob, ...prev])

      // Start polling for progress
      pollJobProgress(result.job_id)
    } catch (error) {
      console.error('Indexing failed:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to start indexing'
      alert('Failed to start indexing: ' + errorMessage)
    } finally {
      setIsIndexing(false)
    }
  }, [uploadId, uploadedFiles.length, uploadFiles])

  const pollJobProgress = async (jobId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`http://localhost:8788/api/data-sources/jobs/${jobId}`)
        const progress = await response.json()

        setJobs(prev => prev.map(job =>
          job.id === jobId
            ? {
                ...job,
                status: progress.status,
                progress: progress.total_items > 0 ? (progress.processed_items / progress.total_items) * 100 : 0,
                processedFiles: progress.processed_items,
                totalFiles: progress.total_items,
                error: progress.error_message,
                completedAt: progress.completed_at ? new Date(progress.completed_at) : undefined
              }
            : job
        ))

        if (progress.status === 'completed' || progress.status === 'failed') {
          clearInterval(pollInterval)
        }
      } catch (error) {
        console.error('Failed to poll job progress:', error)
        clearInterval(pollInterval)
      }
    }, 2000)
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-4 h-4 text-[var(--success)]" />
      case 'failed': return <AlertCircle className="w-4 h-4 text-[var(--error)]" />
      case 'running': return <Clock className="w-4 h-4 text-[var(--accent)] animate-spin" />
      default: return <Clock className="w-4 h-4 ui-text-muted" />
    }
  }

  const getFileStatusIcon = (status: string) => {
    switch (status) {
      case 'uploaded': return <CheckCircle className="w-4 h-4 text-[var(--success)]" />
      case 'failed': return <AlertCircle className="w-4 h-4 text-[var(--error)]" />
      case 'uploading': return <Clock className="w-4 h-4 text-[var(--accent)] animate-spin" />
      default: return null
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel fixed left-0 top-0 h-full w-full max-w-2xl flex flex-col">
        {/* Header */}
        <div className="drawer-header ui-bg-secondary border-b ui-border-faint flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-3">
            {onBack && (
              <button onClick={onBack} className="btn-close">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="drawer-title ui-text-primary">
              <Upload className="w-5 h-5" />
              File Upload & Indexing
            </h2>
          </div>
          <button onClick={onClose} className="btn-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 min-h-0">
          {/* Introduction */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold ui-text-primary mb-2">Upload Documents</h3>
            <p className="ui-text-secondary text-sm mb-6">
              Upload your documents to make them searchable. Supported formats include PDF, DOCX, Markdown, HTML, TXT, and CSV files.
            </p>

            {/* Upload Drop Zone */}
            <div
              className={`
                border-2 border-dashed rounded-[var(--radius-lg)] p-8 text-center transition-all duration-200
                ${isDragOver
                  ? 'border-[var(--accent)] ui-bg-tertiary'
                  : 'ui-border-light hover:border-[var(--accent)] hover:ui-bg-tertiary'
                }
              `}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center">
                <div className="p-4 ui-bg-secondary rounded-[var(--radius-md)] mb-4">
                  <FolderUp className="w-8 h-8 ui-text-secondary" />
                </div>
                <div className="mb-3">
                  <span className="text-base ui-text-primary">Drop files here or </span>
                  <label className="text-[var(--accent)] hover:text-[var(--accent-hover)] cursor-pointer font-medium underline decoration-2 underline-offset-2">
                    browse files
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleFileSelect}
                      accept={supportedTypes.join(',')}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 justify-center text-xs ui-text-muted">
                  <span className="px-2 py-1 ui-bg-secondary rounded-[var(--radius-sm)]">PDF</span>
                  <span className="px-2 py-1 ui-bg-secondary rounded-[var(--radius-sm)]">DOCX</span>
                  <span className="px-2 py-1 ui-bg-secondary rounded-[var(--radius-sm)]">Markdown</span>
                  <span className="px-2 py-1 ui-bg-secondary rounded-[var(--radius-sm)]">HTML</span>
                  <span className="px-2 py-1 ui-bg-secondary rounded-[var(--radius-sm)]">TXT</span>
                  <span className="px-2 py-1 ui-bg-secondary rounded-[var(--radius-sm)]">CSV</span>
                </div>
                <p className="text-xs ui-text-muted mt-2">Maximum file size: 50MB</p>
                {uploadedFiles.length === 0 && (
                  <p className="text-xs ui-text-muted mt-1">
                    Files will be processed and indexed for search
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* File List */}
          {uploadedFiles.length > 0 && (
            <div className="form-section">
              <div className="flex items-center justify-between mb-4">
                <h4 className="form-section-title">
                  Selected Files ({uploadedFiles.length})
                </h4>
                <button
                  onClick={clearAllFiles}
                  className="btn-secondary btn-small text-[var(--error)]"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear All
                </button>
              </div>

              <div className="space-y-3 max-h-60 overflow-y-auto mb-6">
                {uploadedFiles.map(({ file, id, name, size, status, error }) => (
                  <div key={id} className="p-4 ui-bg-secondary border ui-border-faint rounded-[var(--radius-md)]">
                    <div className="flex items-start gap-3">
                      <div className="p-2 ui-bg-tertiary rounded-[var(--radius-sm)]">
                        <FileUp className="w-4 h-4 ui-text-secondary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h5 className="font-medium ui-text-primary text-sm truncate">{name}</h5>
                          <div className="flex items-center gap-2">
                            {getFileStatusIcon(status)}
                            <button
                              onClick={() => removeFile(id)}
                              className="p-1 ui-text-muted hover:text-[var(--error)] transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs ui-text-muted">{formatFileSize(size)}</span>
                          {status === 'uploading' && (
                            <span className="text-xs text-[var(--accent)]">Uploading...</span>
                          )}
                          {status === 'uploaded' && (
                            <span className="text-xs text-[var(--success)]">Uploaded</span>
                          )}
                          {status === 'failed' && (
                            <span className="text-xs text-[var(--error)]">Failed</span>
                          )}
                        </div>
                        {error && (
                          <p className="text-xs text-[var(--error)] mt-1 p-2 ui-bg-tertiary rounded-[var(--radius-sm)]">
                            {error}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                {!uploadId && (
                  <button
                    onClick={uploadFiles}
                    disabled={isUploading || uploadedFiles.length === 0}
                    className="btn-primary flex-1"
                  >
                    <Upload className="w-4 h-4" />
                    {isUploading ? 'Uploading Files...' : 'Upload Files'}
                  </button>
                )}

                <button
                  onClick={startIndexing}
                  disabled={isIndexing || uploadedFiles.length === 0}
                  className="btn-accent flex-1"
                >
                  <Play className="w-4 h-4" />
                  {isIndexing ? 'Starting Indexing...' : 'Start Indexing'}
                </button>
              </div>
            </div>
          )}

          {/* Indexing Jobs */}
          {jobs.length > 0 && (
            <div className="form-section">
              <h4 className="form-section-title mb-4">Indexing Progress</h4>
              <div className="space-y-4">
                {jobs.map((job) => (
                  <div key={job.id} className="p-4 ui-bg-secondary border ui-border-faint rounded-[var(--radius-md)]">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(job.status)}
                        <div>
                          <h5 className="font-medium ui-text-primary text-sm">
                            Indexing Job #{job.id.slice(0, 8)}
                          </h5>
                          <p className="text-xs ui-text-muted">
                            {job.status === 'completed' ? 'Completed successfully' :
                             job.status === 'failed' ? 'Processing failed' :
                             job.status === 'running' ? 'Processing documents...' : 'Pending'}
                          </p>
                        </div>
                      </div>
                      <span className={`
                        px-2 py-1 text-xs font-medium rounded-[var(--radius-sm)]
                        ${job.status === 'completed' ? 'text-[var(--success)] ui-bg-tertiary' :
                          job.status === 'failed' ? 'text-[var(--error)] ui-bg-tertiary' :
                          job.status === 'running' ? 'text-[var(--accent)] ui-bg-tertiary' :
                          'ui-text-muted ui-bg-tertiary'}
                      `}>
                        {job.status === 'completed' ? 'Done' :
                         job.status === 'failed' ? 'Failed' :
                         job.status === 'running' ? 'Processing' : 'Waiting'}
                      </span>
                    </div>

                    {job.status === 'running' && (
                      <div className="mb-3">
                        <div className="flex justify-between text-sm ui-text-secondary mb-2">
                          <span>{job.processedFiles} of {job.totalFiles} documents processed</span>
                          <span className="font-medium">{Math.round(job.progress)}%</span>
                        </div>
                        <div className="w-full ui-bg-tertiary rounded-[var(--radius-sm)] h-2">
                          <div
                            className="bg-[var(--accent)] h-2 rounded-[var(--radius-sm)] transition-all duration-300"
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {job.error && (
                      <div className="mt-3 p-3 ui-bg-tertiary border border-[var(--error)] rounded-[var(--radius-sm)]">
                        <p className="text-sm text-[var(--error)]">{job.error}</p>
                      </div>
                    )}

                    <div className="text-xs ui-text-muted mt-3 pt-3 border-t ui-border-faint">
                      <div className="flex flex-wrap gap-4">
                        <span>Started: {job.startedAt.toLocaleString()}</span>
                        {job.completedAt && (
                          <span>Completed: {job.completedAt.toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {uploadedFiles.length === 0 && (
            <div className="form-section">
              <div className="text-center py-8">
                <div className="p-4 ui-bg-tertiary rounded-[var(--radius-md)] inline-block mb-4">
                  <FileUp className="w-8 h-8 ui-text-secondary" />
                </div>
                <h4 className="font-medium ui-text-primary mb-2">No files selected</h4>
                <p className="text-sm ui-text-secondary">
                  Drop files here or click "browse files" to get started
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}