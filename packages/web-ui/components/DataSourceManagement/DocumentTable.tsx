'use client'

import { useState } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, FileText, Globe, Upload, Database, ExternalLink, Eye, MoreHorizontal, AlertTriangle, Trash2 } from 'lucide-react'
import { IndexedDocument, SortOptions } from './types'

interface DocumentTableProps {
  documents: IndexedDocument[]
  sort: SortOptions
  onSortChange: (sort: SortOptions) => void
  selectedIds: Set<string>
  onSelectDocument: (id: string) => void
  onSelectAll: () => void
  onPreviewDocument?: (document: IndexedDocument) => void
}

// Separate state for action menu (click) vs row hover

export default function DocumentTable({
  documents,
  sort,
  onSortChange,
  selectedIds,
  onSelectDocument,
  onSelectAll,
  onPreviewDocument
}: DocumentTableProps) {
  const [actionMenuId, setActionMenuId] = useState<string | null>(null)

  const handleSort = (field: SortOptions['field']) => {
    if (sort.field === field) {
      onSortChange({
        field,
        direction: sort.direction === 'asc' ? 'desc' : 'asc'
      })
    } else {
      onSortChange({ field, direction: 'asc' })
    }
  }

  const getSortIcon = (field: SortOptions['field']) => {
    if (sort.field !== field) {
      return <ArrowUpDown className="w-4 h-4 ui-text-muted" />
    }
    return sort.direction === 'asc'
      ? <ArrowUp className="w-4 h-4 ui-text-primary" />
      : <ArrowDown className="w-4 h-4 ui-text-primary" />
  }

  const getSourceIcon = (sourceType: string) => {
    switch (sourceType) {
      case 'file_upload':
        return <Upload className="w-4 h-4" />
      case 'confluence':
        return <Globe className="w-4 h-4" />
      case 'web_scraping':
        return <ExternalLink className="w-4 h-4" />
      case 'database':
        return <Database className="w-4 h-4" />
      default:
        return <FileText className="w-4 h-4" />
    }
  }

  const getSourceLabel = (sourceType: string) => {
    switch (sourceType) {
      case 'file_upload':
        return 'File Upload'
      case 'confluence':
        return 'Confluence'
      case 'url_ingestion':
        return 'URL'
      case 'web_scraping':
        return 'Web Scrape'
      case 'database':
        return 'Database'
      default:
        return sourceType.replace('_', ' ')
    }
  }

  const getSpaceInfo = (doc: IndexedDocument) => {
    // For Confluence - show space name
    if (doc.source_type === 'confluence' && (doc as any).space_name) {
      return (doc as any).space_name
    }
    // For URLs - show domain
    if ((doc as any).source_detail) {
      return (doc as any).source_detail
    }
    // For files - show content type
    if (doc.content_type) {
      return doc.content_type
    }
    return '-'
  }

  const formatFileSize = (bytes: number | undefined | null) => {
    if (bytes === undefined || bytes === null || isNaN(bytes) || bytes < 0) return '-'
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown'
    return new Date(dateString).toLocaleDateString()
  }

  const isStaleDocument = (dateString?: string) => {
    if (!dateString) return false
    const docDate = new Date(dateString)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    return docDate < thirtyDaysAgo
  }

  const getDaysSinceUpdate = (dateString?: string) => {
    if (!dateString) return null
    const docDate = new Date(dateString)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - docDate.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'indexed':
        return 'text-[var(--success)]'
      case 'error':
        return 'text-[var(--error)]'
      case 'processing':
        return 'text-[var(--accent)]'
      case 'pending':
        return 'text-[var(--warning)]'
      default:
        return 'ui-text-muted'
    }
  }

  const allSelected = documents.length > 0 && selectedIds.size === documents.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < documents.length

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[800px]">
        <thead>
          <tr className="border-b ui-border-light">
            <th className="w-10 p-3 text-center align-middle">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected
                }}
                onChange={onSelectAll}
                className="rounded"
              />
            </th>
            <th className="text-left p-3">
              <button
                onClick={() => handleSort('title')}
                className="flex items-center gap-2 hover:ui-text-primary transition-colors"
              >
                Title
                {getSortIcon('title')}
              </button>
            </th>
            <th className="text-left p-3 w-32">
              <button
                onClick={() => handleSort('source_type')}
                className="flex items-center gap-2 hover:ui-text-primary transition-colors"
              >
                Source
                {getSortIcon('source_type')}
              </button>
            </th>
            <th className="text-left p-3 w-20">
              <span className="flex items-center gap-2">
                Chunks
              </span>
            </th>
            <th className="text-left p-3 w-32">
              <span className="flex items-center gap-2">
                Space / Info
              </span>
            </th>
            <th className="text-left p-3 w-24">
              <button
                onClick={() => handleSort('status')}
                className="flex items-center gap-2 hover:ui-text-primary transition-colors"
              >
                Status
                {getSortIcon('status')}
              </button>
            </th>
            <th className="text-left p-3 w-28">
              <button
                onClick={() => handleSort('last_modified')}
                className="flex items-center gap-2 hover:ui-text-primary transition-colors"
              >
                Modified
                {getSortIcon('last_modified')}
              </button>
            </th>
            <th className="w-20 p-3 text-center">Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr
              key={doc.id}
              className={`
                border-b ui-border-faint hover:ui-bg-tertiary transition-colors
                ${selectedIds.has(doc.id) ? 'ui-bg-tertiary' : ''}
              `}
            >
              <td className="p-3 text-center align-middle">
                <input
                  type="checkbox"
                  checked={selectedIds.has(doc.id)}
                  onChange={() => onSelectDocument(doc.id)}
                  className="rounded"
                />
              </td>
              <td className="p-3 align-middle">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 ui-bg-secondary rounded flex-shrink-0">
                    {getSourceIcon(doc.source_type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium ui-text-primary text-sm break-words line-clamp-2">
                      {doc.title}
                    </div>
                    {doc.content_type && (
                      <div className="text-xs ui-text-muted">
                        {doc.content_type}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              <td className="p-3">
                <div className="flex items-center gap-2">
                  {getSourceIcon(doc.source_type)}
                  <span className="text-sm ui-text-secondary">
                    {getSourceLabel(doc.source_type)}
                  </span>
                </div>
              </td>
              <td className="p-3">
                <span className="text-sm ui-text-secondary font-medium">
                  {doc.chunk_count || '-'}
                </span>
              </td>
              <td className="p-3">
                <span className="text-sm ui-text-muted truncate max-w-[120px] block" title={getSpaceInfo(doc)}>
                  {getSpaceInfo(doc)}
                </span>
              </td>
              <td className="p-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${doc.status === 'indexed' ? 'bg-[var(--success)]' :
                    doc.status === 'error' ? 'bg-[var(--error)]' :
                      doc.status === 'processing' ? 'bg-[var(--accent)] animate-pulse' :
                        'bg-[var(--warning)]'
                    }`} />
                  <span className={`text-sm capitalize ${getStatusColor(doc.status)}`}>
                    {doc.status}
                  </span>
                  {doc.status === 'error' && doc.error_message && (
                    <span className="text-xs ui-text-muted truncate max-w-[80px]" title={doc.error_message}>
                      ({doc.error_message.slice(0, 20)}...)
                    </span>
                  )}
                </div>
              </td>
              <td className="p-3">
                <div className="flex items-center gap-1">
                  <span className="text-sm ui-text-secondary">
                    {formatDate(doc.last_modified)}
                  </span>
                  {isStaleDocument(doc.last_modified) && (
                    <span
                      title={`Not updated in ${getDaysSinceUpdate(doc.last_modified)} days`}
                      className="text-[var(--warning)]"
                    >
                      <AlertTriangle className="w-3 h-3" />
                    </span>
                  )}
                </div>
              </td>
              <td className="p-3 align-middle">
                <div className="flex items-center gap-1">
                  {onPreviewDocument && (
                    <button
                      onClick={() => onPreviewDocument(doc)}
                      className="p-1.5 hover:ui-bg-secondary rounded transition-colors"
                      title="Preview document"
                    >
                      <Eye className="w-4 h-4 ui-text-muted" />
                    </button>
                  )}
                  <div className="relative">
                    <button
                      onClick={() => setActionMenuId(actionMenuId === doc.id ? null : doc.id)}
                      className="p-1.5 hover:ui-bg-secondary rounded transition-colors"
                      title="More actions"
                    >
                      <MoreHorizontal className="w-4 h-4 ui-text-muted" />
                    </button>
                    {actionMenuId === doc.id && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setActionMenuId(null)}
                        />
                        <div className="absolute right-0 top-full mt-1 w-40 ui-bg-secondary border ui-border-faint rounded-lg shadow-lg z-20">
                          {onPreviewDocument && (
                            <button
                              onClick={() => {
                                onPreviewDocument(doc)
                                setActionMenuId(null)
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:ui-bg-tertiary transition-colors rounded-t-lg"
                            >
                              <Eye className="w-4 h-4" />
                              Preview
                            </button>
                          )}
                          <button
                            onClick={() => {
                              onSelectDocument(doc.id)
                              setActionMenuId(null)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:ui-bg-tertiary text-[var(--error)] transition-colors rounded-b-lg"
                          >
                            <Trash2 className="w-4 h-4" />
                            Select for Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {documents.length === 0 && (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 ui-text-muted mx-auto mb-4" />
          <h4 className="font-medium ui-text-primary mb-2">No documents found</h4>
          <p className="ui-text-muted text-sm">
            Try adjusting your filters or search terms.
          </p>
        </div>
      )}
    </div>
  )
}