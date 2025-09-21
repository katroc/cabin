'use client'

import { useState } from 'react'
import { FileText, Globe, Upload, Database, ExternalLink, Eye, MoreHorizontal, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { IndexedDocument } from './types'

interface DocumentGridProps {
  documents: IndexedDocument[]
  selectedIds: Set<string>
  onSelectDocument: (id: string) => void
  onSelectAll: () => void
  onPreviewDocument?: (document: IndexedDocument) => void
}

export default function DocumentGrid({
  documents,
  selectedIds,
  onSelectDocument,
  onSelectAll,
  onPreviewDocument
}: DocumentGridProps) {
  const [hoveredCard, setHoveredCard] = useState<string | null>(null)

  const getSourceIcon = (sourceType: string) => {
    switch (sourceType) {
      case 'file_upload':
        return <Upload className="w-5 h-5" />
      case 'confluence':
        return <Globe className="w-5 h-5" />
      case 'web_scraping':
        return <ExternalLink className="w-5 h-5" />
      case 'database':
        return <Database className="w-5 h-5" />
      default:
        return <FileText className="w-5 h-5" />
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
    <div className="space-y-4">
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

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className={`
              relative p-4 border rounded-[var(--radius-md)] transition-all cursor-pointer
              ${selectedIds.has(doc.id)
                ? 'border-[var(--accent)] ui-bg-tertiary'
                : 'ui-border-light ui-bg-secondary hover:ui-border-light hover:ui-bg-tertiary'
              }
            `}
            onMouseEnter={() => setHoveredCard(doc.id)}
            onMouseLeave={() => setHoveredCard(null)}
            onClick={() => onSelectDocument(doc.id)}
          >
            {/* Selection Checkbox */}
            <div className="absolute top-3 left-3 z-10">
              <input
                type="checkbox"
                checked={selectedIds.has(doc.id)}
                onChange={(e) => {
                  e.stopPropagation()
                  onSelectDocument(doc.id)
                }}
                className="rounded"
              />
            </div>

            {/* Status Indicator */}
            <div className="absolute top-3 right-3 z-10">
              <div className={`w-3 h-3 rounded-full ${
                doc.status === 'indexed' ? 'bg-[var(--success)]' :
                doc.status === 'error' ? 'bg-[var(--error)]' :
                doc.status === 'processing' ? 'bg-[var(--accent)] animate-pulse' :
                'bg-[var(--warning)]'
              }`} />
            </div>

            {/* Content */}
            <div className="pt-8">
              {/* Source Icon */}
              <div className="flex items-center justify-center w-12 h-12 ui-bg-tertiary rounded-[var(--radius-md)] mb-3 mx-auto">
                {getSourceIcon(doc.source_type)}
              </div>

              {/* Title */}
              <h4 className="font-medium ui-text-primary text-sm mb-2 text-center line-clamp-2">
                {doc.title}
              </h4>

              {/* Metadata */}
              <div className="space-y-1 text-xs ui-text-muted text-center">
                <div className="flex items-center justify-center gap-1">
                  {getSourceIcon(doc.source_type)}
                  <span className="capitalize">{doc.source_type.replace('_', ' ')}</span>
                </div>

                {doc.file_size && (
                  <div>{formatFileSize(doc.file_size)}</div>
                )}

                {doc.page_count && (
                  <div>{doc.page_count} pages</div>
                )}

                {doc.last_modified && (
                  <div>Modified {formatDate(doc.last_modified)}</div>
                )}
              </div>

              {/* Status Text */}
              <div className="mt-2 text-center">
                <span className={`text-xs capitalize ${getStatusColor(doc.status)}`}>
                  {doc.status}
                </span>
              </div>

              {/* Actions */}
              {hoveredCard === doc.id && (
                <div className="absolute top-3 right-12 flex items-center gap-1">
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
        ))}
      </div>

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