'use client'

import { useState, useCallback, useEffect } from 'react'
import { Upload, File, Trash2, Play, CheckCircle, AlertCircle, Clock, X } from 'lucide-react'

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
}

export default function FileUploadIndexing({ isOpen, onClose }: FileUploadIndexingProps) {
  const [mounted, setMounted] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [jobs, setJobs] = useState<IndexingJob[]>([])
  const [isIndexing, setIsIndexing] = useState(false)
  const [uploadId, setUploadId] = useState<string | null>(null)

  // Ensure this component only renders on the client
  useEffect(() => {
    setMounted(true)
  }, [])

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
          alert(`${unsupportedFiles.length} files were skipped (unsupported format). Supported: ${supportedTypes.join(', ')}`)
        }, 100)
      }

      // Check file size (50MB limit)
      const validFiles = supportedFiles.filter(f => f.file.size <= 50 * 1024 * 1024)
      const oversizedFiles = supportedFiles.filter(f => f.file.size > 50 * 1024 * 1024)

      if (oversizedFiles.length > 0) {
        setTimeout(() => {
          alert(`${oversizedFiles.length} files were skipped (over 50MB limit)`)
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
      case 'completed': return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'failed': return <AlertCircle className="w-4 h-4 text-red-500" />
      case 'running': return <Clock className="w-4 h-4 text-blue-500 animate-spin" />
      default: return <Clock className="w-4 h-4 text-gray-500" />
    }
  }

  // Don't render until mounted (prevents SSR issues)
  if (!mounted || !isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <Upload className="w-6 h-6 text-blue-500" />
            <h2 className="text-xl font-semibold">File Upload & Indexing</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
          {/* Upload Area */}
          <div className="mb-8">
            <h3 className="text-lg font-medium mb-4">Upload Files</h3>

            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                isDragOver
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-blue-400'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <div className="mb-2">
                <span className="text-lg">Drop files here or </span>
                <label className="text-blue-500 hover:text-blue-600 cursor-pointer underline">
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
              <p className="text-sm text-gray-500">
                Supported: PDF, DOCX, Markdown, HTML, TXT, CSV (max 50MB each)
              </p>
            </div>

            {uploadedFiles.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">{uploadedFiles.length} files selected</span>
                  <button
                    onClick={clearAllFiles}
                    className="text-sm text-red-500 hover:text-red-600"
                  >
                    Clear all
                  </button>
                </div>

                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {uploadedFiles.map(({ file, id, name, size, status, error }) => (
                    <div key={id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        <File className="w-4 h-4 text-blue-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{name}</p>
                          <p className="text-xs text-gray-500">{formatFileSize(size)}</p>
                          {error && <p className="text-xs text-red-500">{error}</p>}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {status === 'uploaded' && <CheckCircle className="w-4 h-4 text-green-500" />}
                        {status === 'failed' && <AlertCircle className="w-4 h-4 text-red-500" />}
                        {status === 'uploading' && <Clock className="w-4 h-4 text-blue-500 animate-spin" />}
                        <button
                          onClick={() => removeFile(id)}
                          className="p-1 text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex space-x-3">
                  {!uploadId && (
                    <button
                      onClick={uploadFiles}
                      disabled={isUploading || uploadedFiles.length === 0}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                    >
                      <Upload className="w-4 h-4" />
                      <span>{isUploading ? 'Uploading...' : 'Upload Files'}</span>
                    </button>
                  )}

                  <button
                    onClick={startIndexing}
                    disabled={isIndexing || uploadedFiles.length === 0}
                    className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    <Play className="w-4 h-4" />
                    <span>{isIndexing ? 'Starting...' : 'Start Indexing'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Indexing Jobs */}
          {jobs.length > 0 && (
            <div>
              <h3 className="text-lg font-medium mb-4">Indexing Jobs</h3>
              <div className="space-y-4">
                {jobs.map((job) => (
                  <div key={job.id} className="border dark:border-gray-600 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(job.status)}
                        <span className="font-medium">Job {job.id.slice(0, 8)}</span>
                      </div>
                      <span className="text-sm text-gray-500">
                        {job.status === 'completed' ? 'Completed' :
                         job.status === 'failed' ? 'Failed' :
                         job.status === 'running' ? 'Running' : 'Pending'}
                      </span>
                    </div>

                    {job.status === 'running' && (
                      <div className="mb-2">
                        <div className="flex justify-between text-sm text-gray-600 mb-1">
                          <span>{job.processedFiles} of {job.totalFiles} files processed</span>
                          <span>{Math.round(job.progress)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {job.error && (
                      <p className="text-sm text-red-500 mt-2">{job.error}</p>
                    )}

                    <div className="text-xs text-gray-500 mt-2">
                      Started: {job.startedAt.toLocaleString()}
                      {job.completedAt && ` • Completed: ${job.completedAt.toLocaleString()}`}
                    </div>
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