// Enhanced interfaces for Data Source Management system
import React from 'react'

export interface IndexedDocument {
  id: string
  title: string
  source_type: 'file_upload' | 'confluence' | 'web_scraping' | 'database' | 'api'
  source_url?: string
  source_name?: string
  last_modified?: string
  file_size?: number
  page_count?: number
  status: 'indexed' | 'error' | 'processing' | 'pending'
  content_type?: string
  tags?: string[]
  metadata?: {
    author?: string
    created_date?: string
    description?: string
    keywords?: string[]
    language?: string
    [key: string]: any
  }
  chunk_count?: number
  last_indexed?: string
  error_message?: string
}

export interface DataSourceStats {
  total_documents: number
  total_size: number
  last_updated: string
  sources: {
    [key: string]: {
      count: number
      size: number
      last_updated: string
      status: 'active' | 'error' | 'inactive'
    }
  }
  status_distribution: {
    indexed: number
    error: number
    processing: number
    pending: number
  }
}

export interface FilterOptions {
  search: string
  sourceTypes: string[]
  statuses: string[]
  dateRange: {
    from?: Date
    to?: Date
  }
  sizeRange: {
    min?: number
    max?: number
  }
  tags: string[]
  contentTypes: string[]
}

export interface SortOptions {
  field: 'title' | 'source_type' | 'last_modified' | 'file_size' | 'page_count' | 'status' | 'last_indexed'
  direction: 'asc' | 'desc'
}

export interface ViewMode {
  type: 'table' | 'grid' | 'list'
  itemsPerPage: number
}

export interface DocumentSelection {
  selectedIds: Set<string>
  selectAll: boolean
  excludedIds: Set<string>
}

export interface BulkAction {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  action: (selectedIds: string[]) => Promise<void>
  requiresConfirmation?: boolean
  confirmationMessage?: string
}

export interface PaginationState {
  currentPage: number
  totalPages: number
  totalItems: number
  itemsPerPage: number
}

export interface DocumentPreview {
  id: string
  title: string
  content?: string
  metadata: IndexedDocument['metadata']
  chunks?: Array<{
    id: string
    content: string
    page_number?: number
  }>
}

export interface ApiResponse<T> {
  data: T
  pagination?: PaginationState
  filters?: FilterOptions
  success: boolean
  message?: string
}

export interface SearchResult {
  documents: IndexedDocument[]
  total: number
  facets: {
    source_types: Array<{ value: string; count: number }>
    statuses: Array<{ value: string; count: number }>
    content_types: Array<{ value: string; count: number }>
    tags: Array<{ value: string; count: number }>
  }
}

export interface DataSourceManagementState {
  documents: IndexedDocument[]
  stats: DataSourceStats | null
  loading: boolean
  error: string | null
  filters: FilterOptions
  sort: SortOptions
  view: ViewMode
  selection: DocumentSelection
  pagination: PaginationState
  preview: DocumentPreview | null
}