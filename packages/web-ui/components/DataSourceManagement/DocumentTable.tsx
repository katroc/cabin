'use client'

import { useState } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, FileText, Globe, Upload, Database, ExternalLink, Eye, MoreHorizontal } from 'lucide-react'
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

export default function DocumentTable({
  documents,
  sort,
  onSortChange,
  selectedIds,
  onSelectDocument,
  onSelectAll,
  onPreviewDocument
}: DocumentTableProps) {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)

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
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b ui-border-light">
            <th className="w-12 p-3">
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
            <th className="text-left p-3">
              <button
                onClick={() => handleSort('source_type')}
                className="flex items-center gap-2 hover:ui-text-primary transition-colors"
              >
                Source
                {getSortIcon('source_type')}
              </button>
            </th>
            <th className="text-left p-3">
              <button
                onClick={() => handleSort('file_size')}
                className="flex items-center gap-2 hover:ui-text-primary transition-colors"
              >
                Size
                {getSortIcon('file_size')}
              </button>
            </th>
            <th className="text-left p-3">
              <button
                onClick={() => handleSort('page_count')}
                className="flex items-center gap-2 hover:ui-text-primary transition-colors"
              >
                Pages
                {getSortIcon('page_count')}
              </button>
            </th>
            <th className="text-left p-3">
              <button
                onClick={() => handleSort('status')}
                className="flex items-center gap-2 hover:ui-text-primary transition-colors"
              >
                Status
                {getSortIcon('status')}
              </button>
            </th>
            <th className="text-left p-3">
              <button
                onClick={() => handleSort('last_modified')}
                className="flex items-center gap-2 hover:ui-text-primary transition-colors"
              >
                Modified
                {getSortIcon('last_modified')}
              </button>
            </th>
            <th className="w-12 p-3">Actions</th>
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
              onMouseEnter={() => setHoveredRow(doc.id)}
              onMouseLeave={() => setHoveredRow(null)}
            >
              <td className="p-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(doc.id)}
                  onChange={() => onSelectDocument(doc.id)}
                  className="rounded"
                />
              </td>
              <td className="p-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 ui-bg-secondary rounded-[var(--radius-sm)]">
                    {getSourceIcon(doc.source_type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium ui-text-primary text-sm truncate">
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
                  <span className="text-sm ui-text-secondary capitalize">
                    {doc.source_type.replace('_', ' ')}
                  </span>
                </div>
              </td>
              <td className="p-3">
                <span className="text-sm ui-text-secondary">
                  {doc.file_size ? formatFileSize(doc.file_size) : '-'}
                </span>
              </td>
              <td className="p-3">
                <span className="text-sm ui-text-secondary">
                  {doc.page_count || '-'}
                </span>
              </td>
              <td className="p-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    doc.status === 'indexed' ? 'bg-[var(--success)]' :
                    doc.status === 'error' ? 'bg-[var(--error)]' :
                    doc.status === 'processing' ? 'bg-[var(--accent)] animate-pulse' :
                    'bg-[var(--warning)]'
                  }`} />
                  <span className={`text-sm capitalize ${getStatusColor(doc.status)}`}>
                    {doc.status}
                  </span>
                </div>
              </td>
              <td className="p-3">
                <span className="text-sm ui-text-secondary">
                  {formatDate(doc.last_modified)}
                </span>
              </td>
              <td className="p-3">
                <div className="flex items-center gap-1">
                  {onPreviewDocument && (
                    <button
                      onClick={() => onPreviewDocument(doc)}
                      className="p-1 hover:ui-bg-secondary rounded transition-colors"
                      title="Preview document"
                    >
                      <Eye className="w-4 h-4 ui-text-muted" />
                    </button>
                  )}
                  {hoveredRow === doc.id && (
                    <button
                      className="p-1 hover:ui-bg-secondary rounded transition-colors"
                      title="More actions"
                    >
                      <MoreHorizontal className="w-4 h-4 ui-text-muted" />
                    </button>
                  )}
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