'use client'

import { useState } from 'react'
import { FileText, Globe, Upload, Database, ExternalLink, Eye, MoreHorizontal, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { IndexedDocument } from './types'

interface DocumentListProps {
  documents: IndexedDocument[]
  selectedIds: Set<string>
  onSelectDocument: (id: string) => void
  onSelectAll: () => void
  onPreviewDocument?: (document: IndexedDocument) => void
}

export default function DocumentList({
  documents,
  selectedIds,
  onSelectDocument,
  onSelectAll,
  onPreviewDocument
}: DocumentListProps) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

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

  const formatFileSize = (bytes: number) => {
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
    <div className="space-y-2">
      {/* Select All Header */}
      <div className="flex items-center gap-3 p-3 ui-bg-secondary border ui-border-faint rounded-[var(--radius-md)]">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected
          }}
          onChange={onSelectAll}
          className="rounded"
        />
        <span className="text-sm font-medium ui-text-secondary">
          Select All ({documents.length} documents)
        </span>
      </div>

      {/* List Items */}
      {documents.map((doc) => (
        <div
          key={doc.id}
          className={`
            flex items-center gap-4 p-4 border rounded-[var(--radius-md)] transition-all cursor-pointer
            ${selectedIds.has(doc.id)
              ? 'border-[var(--accent)] ui-bg-tertiary'
              : 'ui-border-light ui-bg-secondary hover:ui-border-light hover:ui-bg-tertiary'
            }
          `}
          onMouseEnter={() => setHoveredItem(doc.id)}
          onMouseLeave={() => setHoveredItem(null)}
          onClick={() => onSelectDocument(doc.id)}
        >
          {/* Selection Checkbox */}
          <input
            type="checkbox"
            checked={selectedIds.has(doc.id)}
            onChange={(e) => {
              e.stopPropagation()
              onSelectDocument(doc.id)
            }}
            className="rounded"
          />

          {/* Source Icon */}
          <div className="p-2 ui-bg-tertiary rounded-[var(--radius-sm)]">
            {getSourceIcon(doc.source_type)}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h4 className="font-medium ui-text-primary text-sm mb-1 truncate">
                  {doc.title}
                </h4>
                <div className="flex items-center gap-4 text-xs ui-text-muted">
                  <span className="flex items-center gap-1">
                    {getSourceIcon(doc.source_type)}
                    <span className="capitalize">{doc.source_type.replace('_', ' ')}</span>
                  </span>
                  {doc.file_size && (
                    <span>{formatFileSize(doc.file_size)}</span>
                  )}
                  {doc.page_count && (
                    <span>{doc.page_count} pages</span>
                  )}
                  {doc.last_modified && (
                    <span>Modified {formatDate(doc.last_modified)}</span>
                  )}
                  {doc.content_type && (
                    <span>{doc.content_type}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Status */}
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    doc.status === 'indexed' ? 'bg-[var(--success)]' :
                    doc.status === 'error' ? 'bg-[var(--error)]' :
                    doc.status === 'processing' ? 'bg-[var(--accent)] animate-pulse' :
                    'bg-[var(--warning)]'
                  }`} />
                  <span className={`text-xs capitalize ${getStatusColor(doc.status)}`}>
                    {doc.status}
                  </span>
                </div>

                {/* Actions */}
                {hoveredItem === doc.id && (
                  <div className="flex items-center gap-1">
                    {onPreviewDocument && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onPreviewDocument(doc)
                        }}
                        className="p-1 hover:ui-bg-secondary rounded transition-colors"
                        title="Preview document"
                      >
                        <Eye className="w-4 h-4 ui-text-muted" />
                      </button>
                    )}
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 hover:ui-bg-secondary rounded transition-colors"
                      title="More actions"
                    >
                      <MoreHorizontal className="w-4 h-4 ui-text-muted" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}

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