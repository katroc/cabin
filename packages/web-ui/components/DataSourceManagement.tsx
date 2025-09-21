'use client'

import { useState, useEffect } from 'react'
import { ArrowLeft, Database, FileText, Globe, Upload, Trash2, RefreshCw, CheckCircle, AlertCircle, Clock, Info } from 'lucide-react'

interface IndexedDocument {
  id: string
  title: string
  source_type: string
  source_url: string
  last_modified?: string
  file_size?: number
  page_count?: number
  status: 'indexed' | 'error' | 'processing'
}

interface DataSourceStats {
  total_documents: number
  total_size: number
  last_updated: string
  sources: {
    [key: string]: {
      count: number
      size: number
      last_updated: string
    }
  }
}

interface DataSourceManagementProps {
  isOpen: boolean
  onClose: () => void
  onBack: () => void
}

export default function DataSourceManagement({ isOpen, onClose, onBack }: DataSourceManagementProps) {
  const [documents, setDocuments] = useState<IndexedDocument[]>([])
  const [stats, setStats] = useState<DataSourceStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      fetchIndexedDocuments()
      fetchStats()
    }
  }, [isOpen])

  const fetchIndexedDocuments = async () => {
    try {
      // This would be a real API call to get indexed documents
      // For now, using mock data
      const mockDocuments: IndexedDocument[] = [
        {
          id: 'doc_1',
          title: 'Defence White Paper 2009',
          source_type: 'file_upload',
          source_url: 'file://defence_white_paper_2009.pdf',
          last_modified: new Date().toISOString(),
          file_size: 2500000,
          page_count: 142,
          status: 'indexed'
        }
      ]
      setDocuments(mockDocuments)
    } catch (error) {
      console.error('Failed to fetch documents:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      // This would be a real API call to get stats
      const mockStats: DataSourceStats = {
        total_documents: 1,
        total_size: 2500000,
        last_updated: new Date().toISOString(),
        sources: {
          file_upload: {
            count: 1,
            size: 2500000,
            last_updated: new Date().toISOString()
          }
        }
      }
      setStats(mockStats)
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getSourceIcon = (sourceType: string) => {
    switch (sourceType) {
      case 'file_upload':
        return Upload
      case 'confluence':
        return Globe
      default:
        return FileText
    }
  }

  const getSourceLabel = (sourceType: string) => {
    switch (sourceType) {
      case 'file_upload':
        return 'File Upload'
      case 'confluence':
        return 'Confluence'
      default:
        return sourceType
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'indexed':
        return <CheckCircle className="w-4 h-4 text-[var(--success)]" />
      case 'error':
        return <AlertCircle className="w-4 h-4 text-[var(--error)]" />
      case 'processing':
        return <Clock className="w-4 h-4 text-[var(--accent)] animate-spin" />
      default:
        return <Info className="w-4 h-4 ui-text-muted" />
    }
  }

  const handleSelectAll = () => {
    if (selectedDocuments.size === documents.length) {
      setSelectedDocuments(new Set())
    } else {
      setSelectedDocuments(new Set(documents.map(doc => doc.id)))
    }
  }

  const handleSelectDocument = (id: string) => {
    const newSelected = new Set(selectedDocuments)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedDocuments(newSelected)
  }

  const handleDeleteSelected = async () => {
    if (selectedDocuments.size === 0) return

    setDeleting(true)
    try {
      // This would be a real API call to delete documents
      const idsToDelete = Array.from(selectedDocuments)
      console.log('Deleting documents:', idsToDelete)

      // Update local state
      setDocuments(docs => docs.filter(doc => !selectedDocuments.has(doc.id)))
      setSelectedDocuments(new Set())

      // Refresh stats
      await fetchStats()
    } catch (error) {
      console.error('Failed to delete documents:', error)
    } finally {
      setDeleting(false)
    }
  }

  const handleRefresh = () => {
    setLoading(true)
    fetchIndexedDocuments()
    fetchStats()
  }

  if (!isOpen) return null

  return (
    <div className="drawer-overlay">
      <div className="drawer-panel fixed right-0 top-0 h-full w-full max-w-4xl overflow-hidden">
        {/* Header */}
        <div className="drawer-header">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="btn-close">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="drawer-title">
              <Database className="w-5 h-5 ui-text-secondary" />
              Data Source Management
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="btn-secondary btn-small"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button onClick={onClose} className="btn-close">
              ×
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto h-full">
          {/* Stats Overview */}
          {stats && (
            <div className="mb-8">
              <h3 className="text-lg font-semibold ui-text-primary mb-4">Overview</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 ui-bg-tertiary border ui-border-faint rounded-[var(--radius-md)]">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="w-4 h-4 ui-text-secondary" />
                    <span className="text-sm font-medium ui-text-secondary">Total Documents</span>
                  </div>
                  <div className="text-2xl font-bold ui-text-primary">{stats.total_documents}</div>
                </div>
                <div className="p-4 ui-bg-tertiary border ui-border-faint rounded-[var(--radius-md)]">
                  <div className="flex items-center gap-2 mb-2">
                    <Database className="w-4 h-4 ui-text-secondary" />
                    <span className="text-sm font-medium ui-text-secondary">Total Size</span>
                  </div>
                  <div className="text-2xl font-bold ui-text-primary">{formatFileSize(stats.total_size)}</div>
                </div>
                <div className="p-4 ui-bg-tertiary border ui-border-faint rounded-[var(--radius-md)]">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 ui-text-secondary" />
                    <span className="text-sm font-medium ui-text-secondary">Last Updated</span>
                  </div>
                  <div className="text-sm ui-text-primary">{new Date(stats.last_updated).toLocaleDateString()}</div>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold ui-text-primary">Indexed Documents</h3>
            <div className="flex items-center gap-2">
              {selectedDocuments.size > 0 && (
                <button
                  onClick={handleDeleteSelected}
                  disabled={deleting}
                  className="btn-danger btn-small"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete {selectedDocuments.size} item{selectedDocuments.size > 1 ? 's' : ''}
                </button>
              )}
            </div>
          </div>

          {/* Document List */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3 ui-text-muted">
                <RefreshCw className="w-5 h-5 animate-spin" />
                Loading documents...
              </div>
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12">
              <Database className="w-12 h-12 ui-text-muted mx-auto mb-4" />
              <h4 className="font-medium ui-text-primary mb-2">No documents found</h4>
              <p className="ui-text-muted text-sm">
                Start by adding a data source to index your content.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Select All Header */}
              <div className="flex items-center gap-3 p-3 ui-bg-secondary border ui-border-faint rounded-[var(--radius-md)]">
                <input
                  type="checkbox"
                  checked={selectedDocuments.size === documents.length && documents.length > 0}
                  onChange={handleSelectAll}
                  className="rounded"
                />
                <span className="text-sm font-medium ui-text-secondary">
                  Select All ({documents.length} documents)
                </span>
              </div>

              {/* Document Items */}
              {documents.map((doc) => {
                const SourceIcon = getSourceIcon(doc.source_type)
                return (
                  <div
                    key={doc.id}
                    className={`
                      p-4 border rounded-[var(--radius-md)] transition-all
                      ${selectedDocuments.has(doc.id)
                        ? 'border-[var(--accent)] ui-bg-tertiary'
                        : 'ui-border-light ui-bg-secondary hover:ui-border-light hover:ui-bg-tertiary'
                      }
                    `}
                  >
                    <div className="flex items-start gap-4">
                      <input
                        type="checkbox"
                        checked={selectedDocuments.has(doc.id)}
                        onChange={() => handleSelectDocument(doc.id)}
                        className="mt-1 rounded"
                      />

                      <div className="p-2 ui-bg-tertiary rounded-[var(--radius-sm)]">
                        <SourceIcon className="w-4 h-4 ui-text-secondary" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <h4 className="font-medium ui-text-primary text-sm mb-1 truncate">
                              {doc.title}
                            </h4>
                            <div className="flex items-center gap-4 text-xs ui-text-muted">
                              <span className="flex items-center gap-1">
                                <SourceIcon className="w-3 h-3" />
                                {getSourceLabel(doc.source_type)}
                              </span>
                              {doc.file_size && (
                                <span>{formatFileSize(doc.file_size)}</span>
                              )}
                              {doc.page_count && (
                                <span>{doc.page_count} pages</span>
                              )}
                              {doc.last_modified && (
                                <span>Modified {new Date(doc.last_modified).toLocaleDateString()}</span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {getStatusIcon(doc.status)}
                            <span className="text-xs ui-text-muted capitalize">{doc.status}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}