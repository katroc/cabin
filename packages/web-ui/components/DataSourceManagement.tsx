'use client'

import { useState, useEffect, useMemo } from 'react'
import { ArrowLeft, Database, FileText, Globe, Upload, Trash2, RefreshCw, CheckCircle, AlertCircle, Clock, Info, X, Grid, List, Table, ChevronUp } from 'lucide-react'
import FilterBar from './DataSourceManagement/FilterBar'
import DocumentTable from './DataSourceManagement/DocumentTable'
import DocumentGrid from './DataSourceManagement/DocumentGrid'
import DocumentList from './DataSourceManagement/DocumentList'
import BulkActions, { defaultBulkActions } from './DataSourceManagement/BulkActions'
import ConfirmationModal from './ConfirmationModal'
import { useToast } from './ToastProvider'
import {
  IndexedDocument,
  DataSourceStats,
  FilterOptions,
  SortOptions,
  ViewMode,
  DocumentSelection
} from './DataSourceManagement/types'

interface DataSourceManagementProps {
  isOpen: boolean
  onClose: () => void
  onBack: () => void
}

export default function DataSourceManagement({ isOpen, onClose, onBack }: DataSourceManagementProps) {
  const { addToast } = useToast()
  const [documents, setDocuments] = useState<IndexedDocument[]>([])
  const [stats, setStats] = useState<DataSourceStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showClearConfirmation, setShowClearConfirmation] = useState(false)

  // Enhanced state management
  const [filters, setFilters] = useState<FilterOptions>({
    search: '',
    sourceTypes: [],
    statuses: [],
    dateRange: {},
    sizeRange: {},
    tags: [],
    contentTypes: []
  })

  const [sort, setSort] = useState<SortOptions>({
    field: 'last_modified',
    direction: 'desc'
  })

  const [view, setView] = useState<ViewMode>({
    type: 'table',
    itemsPerPage: 50
  })

  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0
  })

  // Utility function to ensure tags is always an array
  const normalizeTags = (tags: any): string[] => {
    if (!tags) return []
    if (Array.isArray(tags)) return tags
    if (typeof tags === 'string') return [tags]
    return []
  }

  const [selection, setSelection] = useState<DocumentSelection>({
    selectedIds: new Set(),
    selectAll: false,
    excludedIds: new Set()
  })



  useEffect(() => {
    if (isOpen) {
      fetchIndexedDocuments()
      fetchStats()
    }
  }, [isOpen])

  // Filter and sort documents
  const filteredAndSortedDocuments = useMemo(() => {
    let filtered = documents.filter(doc => {
      // Search filter
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase()
        const matchesTitle = doc.title.toLowerCase().includes(searchTerm)
        const matchesContent = doc.content_type?.toLowerCase().includes(searchTerm)
        const matchesSource = doc.source_type.toLowerCase().includes(searchTerm)
        if (!matchesTitle && !matchesContent && !matchesSource) return false
      }

      // Source type filter
      if (filters.sourceTypes.length > 0 && !filters.sourceTypes.includes(doc.source_type)) {
        return false
      }

      // Status filter
      if (filters.statuses.length > 0 && !filters.statuses.includes(doc.status)) {
        return false
      }

      // Date range filter
      if (filters.dateRange.from || filters.dateRange.to) {
        const docDate = doc.last_modified ? new Date(doc.last_modified) : null
        if (filters.dateRange.from && (!docDate || docDate < filters.dateRange.from)) return false
        if (filters.dateRange.to && (!docDate || docDate > filters.dateRange.to)) return false
      }

      // Size range filter
      if (filters.sizeRange.min !== undefined && (!doc.file_size || doc.file_size < filters.sizeRange.min)) return false
      if (filters.sizeRange.max !== undefined && (!doc.file_size || doc.file_size > filters.sizeRange.max)) return false

      // Tags filter
      const docTags = normalizeTags(doc.tags)
      if (filters.tags.length > 0 && (!docTags.length || !filters.tags.some(tag => docTags.includes(tag)))) {
        return false
      }

      // Content type filter
      if (filters.contentTypes.length > 0 && (!doc.content_type || !filters.contentTypes.includes(doc.content_type))) {
        return false
      }

      return true
    })

    // Sort documents
    filtered.sort((a, b) => {
      let aValue: any, bValue: any

      switch (sort.field) {
        case 'title':
          aValue = a.title.toLowerCase()
          bValue = b.title.toLowerCase()
          break
        case 'source_type':
          aValue = a.source_type
          bValue = b.source_type
          break
        case 'file_size':
          aValue = a.file_size || 0
          bValue = b.file_size || 0
          break
        case 'page_count':
          aValue = a.page_count || 0
          bValue = b.page_count || 0
          break
        case 'status':
          aValue = a.status
          bValue = b.status
          break
        case 'last_modified':
          aValue = a.last_modified ? new Date(a.last_modified).getTime() : 0
          bValue = b.last_modified ? new Date(b.last_modified).getTime() : 0
          break
        case 'last_indexed':
          aValue = a.last_indexed ? new Date(a.last_indexed).getTime() : 0
          bValue = b.last_indexed ? new Date(b.last_indexed).getTime() : 0
          break
        default:
          return 0
      }

      if (aValue < bValue) return sort.direction === 'asc' ? -1 : 1
      if (aValue > bValue) return sort.direction === 'asc' ? 1 : -1
      return 0
    })

    return filtered
  }, [documents, filters, sort])

  const fetchIndexedDocuments = async () => {
    try {
      setLoading(true)
      setError(null)

      // Build query parameters for filtering
      const params = new URLSearchParams()
      if (filters.search) params.append('search', filters.search)
      if (filters.sourceTypes.length > 0) params.append('source_types', filters.sourceTypes.join(','))
      if (filters.statuses.length > 0) params.append('statuses', filters.statuses.join(','))
      if (filters.dateRange.from) params.append('date_from', filters.dateRange.from.toISOString())
      if (filters.dateRange.to) params.append('date_to', filters.dateRange.to.toISOString())
      if (filters.sizeRange.min !== undefined) params.append('size_min', filters.sizeRange.min.toString())
      if (filters.sizeRange.max !== undefined) params.append('size_max', filters.sizeRange.max.toString())
      if (filters.tags.length > 0) params.append('tags', filters.tags.join(','))
      if (filters.contentTypes.length > 0) params.append('content_types', filters.contentTypes.join(','))
      params.append('sort_field', sort.field)
      params.append('sort_direction', sort.direction)
      params.append('limit', view.itemsPerPage.toString())
      params.append('offset', ((pagination.currentPage - 1) * view.itemsPerPage).toString())

      const offset = (pagination.currentPage - 1) * view.itemsPerPage
      const response = await fetch(`http://localhost:8788/api/data-sources/documents?${params}`)
      if (response.ok) {
        const data = await response.json()
        setDocuments(data.documents || [])
        setPagination({
          currentPage: pagination.currentPage,
          totalPages: Math.ceil(data.total / view.itemsPerPage),
          totalItems: data.total
        })
      } else {
        throw new Error(`Failed to fetch documents: ${response.status}`)
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error)
      setError(error instanceof Error ? error.message : 'Failed to fetch documents')
      setDocuments([])
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      const response = await fetch('http://localhost:8788/api/data-sources/stats')
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      } else {
        console.error('Failed to fetch stats:', response.status)
        setStats(null)
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error)
      setStats(null)
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

  // Selection management
  const handleSelectAll = () => {
    const filteredIds = filteredAndSortedDocuments.map(doc => doc.id)
    if (selection.selectedIds.size === filteredIds.length) {
      setSelection({
        selectedIds: new Set(),
        selectAll: false,
        excludedIds: new Set()
      })
    } else {
      setSelection({
        selectedIds: new Set(filteredIds),
        selectAll: true,
        excludedIds: new Set()
      })
    }
  }

  const handleSelectDocument = (id: string) => {
    const newSelected = new Set(selection.selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
      if (selection.selectAll) {
        const newExcluded = new Set(selection.excludedIds)
        newExcluded.add(id)
        setSelection({
          ...selection,
          selectedIds: newSelected,
          excludedIds: newExcluded
        })
      } else {
        setSelection({
          ...selection,
          selectedIds: newSelected
        })
      }
    } else {
      newSelected.add(id)
      if (selection.selectAll) {
        const newExcluded = new Set(selection.excludedIds)
        newExcluded.delete(id)
        setSelection({
          ...selection,
          selectedIds: newSelected,
          excludedIds: newExcluded
        })
      } else {
        setSelection({
          ...selection,
          selectedIds: newSelected
        })
      }
    }
  }

  const handleBulkActionComplete = () => {
    setSelection({
      selectedIds: new Set(),
      selectAll: false,
      excludedIds: new Set()
    })
    fetchIndexedDocuments()
    fetchStats()
  }

  const handleRefresh = () => {
    setLoading(true)
    fetchIndexedDocuments()
    fetchStats()
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
        // Refresh the data after clearing
        handleRefresh()
      } else {
        throw new Error('Failed to clear index')
      }
    } catch (error) {
      console.error('Failed to clear index:', error)
      addToast('Failed to clear the index. Please try again.', 'error')
    }
  }

  const handleCancelClearIndex = () => {
    setShowClearConfirmation(false)
  }

  // Get available filter options from current documents
  const availableOptions = useMemo(() => {
    const sourceTypes = new Set<string>()
    const statuses = new Set<string>()
    const contentTypes = new Set<string>()
    const tags = new Set<string>()

    documents.forEach(doc => {
      if (doc.source_type) sourceTypes.add(doc.source_type)
      if (doc.status) statuses.add(doc.status)
      if (doc.content_type) contentTypes.add(doc.content_type)
      const docTags = normalizeTags(doc.tags)
      docTags.forEach(tag => tags.add(tag))
    })

    return {
      sourceTypes: Array.from(sourceTypes).sort(),
      statuses: Array.from(statuses).sort(),
      contentTypes: Array.from(contentTypes).sort(),
      tags: Array.from(tags).sort()
    }
  }, [documents])

  if (!isOpen) return null

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel fixed right-0 top-0 h-full w-full max-w-6xl overflow-hidden">
        {/* Header */}
         <div className="drawer-header" onClick={(e) => e.stopPropagation()}>
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
               onClick={handleClearIndex}
               className="btn-secondary btn-small"
             >
               <Trash2 className="w-4 h-4" />
               Clear Index
             </button>
             <button
               onClick={handleRefresh}
               disabled={loading}
               className="btn-secondary btn-small"
             >
               <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
               Refresh
             </button>
             <button onClick={onClose} className="btn-close">
               <X className="w-4 h-4" />
             </button>
           </div>
         </div>

        <div className="p-6 overflow-y-auto h-full" onClick={(e) => e.stopPropagation()}>
          {/* Error Display */}
          {error && (
            <div className="mb-6 p-4 ui-bg-error border border-[var(--error)] rounded-lg">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[var(--error)]" />
                <span className="text-sm font-medium text-[var(--error)]">Error</span>
              </div>
              <p className="text-sm text-[var(--error)] mt-1">{error}</p>
            </div>
          )}

          {/* Stats Overview */}
          {stats && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold ui-text-primary mb-4">Overview</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 ui-bg-tertiary border ui-border-faint rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="w-4 h-4 ui-text-secondary" />
                    <span className="text-sm font-medium ui-text-secondary">Total Documents</span>
                  </div>
                  <div className="text-2xl font-bold ui-text-primary">{stats.total_documents}</div>
                </div>
                <div className="p-4 ui-bg-tertiary border ui-border-faint rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Database className="w-4 h-4 ui-text-secondary" />
                    <span className="text-sm font-medium ui-text-secondary">Total Size</span>
                  </div>
                  <div className="text-2xl font-bold ui-text-primary">{formatFileSize(stats.total_size)}</div>
                </div>
                <div className="p-4 ui-bg-tertiary border ui-border-faint rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 ui-text-secondary" />
                    <span className="text-sm font-medium ui-text-secondary">Last Updated</span>
                  </div>
                  <div className="text-lg font-semibold ui-text-primary">
                    {stats.last_updated ? new Date(stats.last_updated).toLocaleDateString() : 'Never'}
                  </div>
                </div>
                <div className="p-4 ui-bg-tertiary border ui-border-faint rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-4 h-4 ui-text-secondary" />
                    <span className="text-sm font-medium ui-text-secondary">Indexed</span>
                  </div>
                  <div className="text-2xl font-bold text-[var(--success)]">
                    {stats.status_distribution?.indexed || 0}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Filter Bar */}
          <FilterBar
            filters={filters}
            onFiltersChange={setFilters}
            availableSourceTypes={availableOptions.sourceTypes}
            availableStatuses={availableOptions.statuses}
            availableContentTypes={availableOptions.contentTypes}
            availableTags={availableOptions.tags}
          />



          {/* Documents Header with Bulk Actions */}
           <div className="flex items-center justify-between h-12 mb-4">
             <div className="flex items-center gap-4 h-full">
               <h3 className="text-lg font-semibold ui-text-primary">
                 Documents ({pagination.totalItems})
               </h3>

               {/* Items Per Page Selector */}
               <select
                 value={view.itemsPerPage}
                 onChange={(e) => {
                   const newItemsPerPage = parseInt(e.target.value)
                   setView({ ...view, itemsPerPage: newItemsPerPage })
                   setPagination({ ...pagination, currentPage: 1 })
                 }}
                 className="px-3 py-2 text-sm border ui-border-light rounded-md ui-bg-secondary btn-standard"
               >
                 <option value={25}>25 per page</option>
                 <option value={50}>50 per page</option>
                 <option value={100}>100 per page</option>
                 <option value={200}>200 per page</option>
               </select>

               {/* View Toggle */}
               <div className="flex items-center gap-1 p-1 ui-bg-secondary border ui-border-faint rounded-lg h-9">
                 <button
                   onClick={() => setView({ ...view, type: 'table' })}
                   className={`p-2 rounded-md transition-colors h-7 w-7 flex items-center justify-center ${
                     view.type === 'table' ? 'ui-bg-tertiary' : 'hover:ui-bg-tertiary'
                   }`}
                   title="Table view"
                 >
                   <Table className="w-4 h-4" />
                 </button>
                 <button
                   onClick={() => setView({ ...view, type: 'grid' })}
                   className={`p-2 rounded-md transition-colors h-7 w-7 flex items-center justify-center ${
                     view.type === 'grid' ? 'ui-bg-tertiary' : 'hover:ui-bg-tertiary'
                   }`}
                   title="Grid view"
                 >
                   <Grid className="w-4 h-4" />
                 </button>
                 <button
                   onClick={() => setView({ ...view, type: 'list' })}
                   className={`p-2 rounded-md transition-colors h-7 w-7 flex items-center justify-center ${
                     view.type === 'list' ? 'ui-bg-tertiary' : 'hover:ui-bg-tertiary'
                   }`}
                   title="List view"
                 >
                   <List className="w-4 h-4" />
                 </button>
               </div>
             </div>

             {/* Bulk Actions in Documents Header */}
             <div className="flex items-center h-full">
               <BulkActions
                 selectedIds={Array.from(selection.selectedIds)}
                 actions={defaultBulkActions}
                 onActionComplete={handleBulkActionComplete}
                 hasSelection={selection.selectedIds.size > 0}
                 compact={true}
               />
             </div>
           </div>

          {/* Document Display */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3 ui-text-muted">
                <RefreshCw className="w-5 h-5 animate-spin" />
                Loading documents...
              </div>
            </div>
          ) : filteredAndSortedDocuments.length === 0 ? (
            <div className="text-center py-12">
              <Database className="w-12 h-12 ui-text-muted mx-auto mb-4" />
              <h4 className="font-medium ui-text-primary mb-2">No documents found</h4>
              <p className="ui-text-muted text-sm">
                {documents.length === 0
                  ? 'Start by adding a data source to index your content.'
                  : 'Try adjusting your filters or search terms.'
                }
              </p>
            </div>
          ) : (
            <div>
              {view.type === 'table' && (
                <DocumentTable
                  documents={filteredAndSortedDocuments}
                  sort={sort}
                  onSortChange={setSort}
                  selectedIds={selection.selectedIds}
                  onSelectDocument={handleSelectDocument}
                  onSelectAll={handleSelectAll}
                />
              )}

              {view.type === 'grid' && (
                <DocumentGrid
                  documents={filteredAndSortedDocuments}
                  selectedIds={selection.selectedIds}
                  onSelectDocument={handleSelectDocument}
                  onSelectAll={handleSelectAll}
                />
              )}

              {view.type === 'list' && (
                <DocumentList
                  documents={filteredAndSortedDocuments}
                  selectedIds={selection.selectedIds}
                  onSelectDocument={handleSelectDocument}
                  onSelectAll={handleSelectAll}
                />
              )}

              {/* Pagination Controls */}
              {pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-6 pt-4 border-t ui-border-faint">
                  <div className="flex items-center gap-2 text-sm ui-text-muted">
                    <span>
                      Showing {Math.min((pagination.currentPage - 1) * view.itemsPerPage + 1, pagination.totalItems)} to{' '}
                      {Math.min(pagination.currentPage * view.itemsPerPage, pagination.totalItems)} of{' '}
                      {pagination.totalItems} documents
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const newPage = pagination.currentPage - 1
                        if (newPage >= 1) {
                          setPagination({ ...pagination, currentPage: newPage })
                        }
                      }}
                      disabled={pagination.currentPage <= 1}
                      className="px-3 py-1 text-sm border ui-border-light rounded-md hover:ui-bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>

                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                        let pageNum: number
                        if (pagination.totalPages <= 5) {
                          pageNum = i + 1
                        } else if (pagination.currentPage <= 3) {
                          pageNum = i + 1
                        } else if (pagination.currentPage >= pagination.totalPages - 2) {
                          pageNum = pagination.totalPages - 4 + i
                        } else {
                          pageNum = pagination.currentPage - 2 + i
                        }

                        return (
                          <button
                            key={pageNum}
                            onClick={() => setPagination({ ...pagination, currentPage: pageNum })}
                            className={`px-3 py-1 text-sm border rounded-md ${
                              pagination.currentPage === pageNum
                                ? 'ui-bg-tertiary border-[var(--accent)] ui-text-primary'
                                : 'ui-border-light hover:ui-bg-tertiary'
                            }`}
                          >
                            {pageNum}
                          </button>
                        )
                      })}
                    </div>

                    <button
                      onClick={() => {
                        const newPage = pagination.currentPage + 1
                        if (newPage <= pagination.totalPages) {
                          setPagination({ ...pagination, currentPage: newPage })
                        }
                      }}
                      disabled={pagination.currentPage >= pagination.totalPages}
                      className="px-3 py-1 text-sm border ui-border-light rounded-md hover:ui-bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={showClearConfirmation}
        title="Clear Index"
        message="Are you sure you want to clear the entire index? This will remove all indexed documents from all data sources. This action cannot be undone."
        confirmText="Clear Index"
        cancelText="Cancel"
        onConfirm={handleConfirmClearIndex}
        onCancel={handleCancelClearIndex}
        type="danger"
      />
    </div>
  )
}