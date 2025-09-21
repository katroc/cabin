'use client'

import { useState, useEffect } from 'react'
import { Search, Filter, X, Calendar, FileText, Tag, ChevronDown, ChevronUp } from 'lucide-react'
import { FilterOptions } from './types'

interface FilterBarProps {
  filters: FilterOptions
  onFiltersChange: (filters: FilterOptions) => void
  availableSourceTypes: string[]
  availableStatuses: string[]
  availableContentTypes: string[]
  availableTags: string[]
}

export default function FilterBar({
  filters,
  onFiltersChange,
  availableSourceTypes,
  availableStatuses,
  availableContentTypes,
  availableTags
}: FilterBarProps) {
  const [localFilters, setLocalFilters] = useState<FilterOptions>(filters)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    setLocalFilters(filters)
  }, [filters])

  const updateFilters = (newFilters: Partial<FilterOptions>) => {
    const updated = { ...localFilters, ...newFilters }
    setLocalFilters(updated)
    onFiltersChange(updated)
  }

  const clearAllFilters = () => {
    const clearedFilters: FilterOptions = {
      search: '',
      sourceTypes: [],
      statuses: [],
      dateRange: {},
      sizeRange: {},
      tags: [],
      contentTypes: []
    }
    setLocalFilters(clearedFilters)
    onFiltersChange(clearedFilters)
  }

  const hasActiveFilters = () => {
    return (
      localFilters.search ||
      localFilters.sourceTypes.length > 0 ||
      localFilters.statuses.length > 0 ||
      localFilters.dateRange.from ||
      localFilters.dateRange.to ||
      localFilters.sizeRange.min !== undefined ||
      localFilters.sizeRange.max !== undefined ||
      localFilters.tags.length > 0 ||
      localFilters.contentTypes.length > 0
    )
  }

  const getActiveFilterCount = () => {
    let count = 0
    if (localFilters.search) count++
    if (localFilters.sourceTypes.length > 0) count++
    if (localFilters.statuses.length > 0) count++
    if (localFilters.dateRange.from || localFilters.dateRange.to) count++
    if (localFilters.sizeRange.min !== undefined || localFilters.sizeRange.max !== undefined) count++
    if (localFilters.tags.length > 0) count++
    if (localFilters.contentTypes.length > 0) count++
    return count
  }



  return (
    <div className="mb-6 space-y-4">
      {/* Main Search and Quick Filters */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Search Input */}
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 ui-text-muted" />
            <input
               type="text"
               placeholder="Search documents by title, content, or metadata..."
               value={localFilters.search}
               onChange={(e) => updateFilters({ search: e.target.value })}
               className="w-full pl-12 pr-4 py-2 border ui-border-light rounded-[var(--radius-md)] ui-bg-secondary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
             />
            {localFilters.search && (
              <button
                onClick={() => updateFilters({ search: '' })}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 ui-text-muted hover:ui-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Quick Filter Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`btn-secondary btn-small ${showAdvanced ? 'ui-bg-tertiary' : ''}`}
          >
            <Filter className="w-4 h-4" />
            Advanced
            {showAdvanced ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
          </button>

          {hasActiveFilters() && (
            <button
              onClick={clearAllFilters}
              className="btn-secondary btn-small"
            >
              <X className="w-4 h-4" />
              Clear All
            </button>
          )}


        </div>
      </div>

      {/* Advanced Filters */}
      {showAdvanced && (
        <div className="p-4 ui-bg-secondary border ui-border-faint rounded-[var(--radius-md)] space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Source Type Filter */}
            <div>
              <label className="block text-sm font-medium ui-text-secondary mb-2">
                Source Type
              </label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {availableSourceTypes.map((type) => (
                  <label key={type} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={localFilters.sourceTypes.includes(type)}
                      onChange={(e) => {
                        const updated = e.target.checked
                          ? [...localFilters.sourceTypes, type]
                          : localFilters.sourceTypes.filter(t => t !== type)
                        updateFilters({ sourceTypes: updated })
                      }}
                      className="rounded"
                    />
                    <FileText className="w-3 h-3 ui-text-muted" />
                    {type}
                  </label>
                ))}
              </div>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium ui-text-secondary mb-2">
                Status
              </label>
              <div className="space-y-2">
                {availableStatuses.map((status) => (
                  <label key={status} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={localFilters.statuses.includes(status)}
                      onChange={(e) => {
                        const updated = e.target.checked
                          ? [...localFilters.statuses, status]
                          : localFilters.statuses.filter(s => s !== status)
                        updateFilters({ statuses: updated })
                      }}
                      className="rounded"
                    />
                    <span className="capitalize">{status}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Content Type Filter */}
            <div>
              <label className="block text-sm font-medium ui-text-secondary mb-2">
                Content Type
              </label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {availableContentTypes.map((type) => (
                  <label key={type} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={localFilters.contentTypes.includes(type)}
                      onChange={(e) => {
                        const updated = e.target.checked
                          ? [...localFilters.contentTypes, type]
                          : localFilters.contentTypes.filter(t => t !== type)
                        updateFilters({ contentTypes: updated })
                      }}
                      className="rounded"
                    />
                    {type}
                  </label>
                ))}
              </div>
            </div>

            {/* Tags Filter */}
            <div>
              <label className="block text-sm font-medium ui-text-secondary mb-2">
                Tags
              </label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {availableTags.map((tag) => (
                  <label key={tag} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={localFilters.tags.includes(tag)}
                      onChange={(e) => {
                        const updated = e.target.checked
                          ? [...localFilters.tags, tag]
                          : localFilters.tags.filter(t => t !== tag)
                        updateFilters({ tags: updated })
                      }}
                      className="rounded"
                    />
                    <Tag className="w-3 h-3 ui-text-muted" />
                    {tag}
                  </label>
                ))}
              </div>
            </div>

            {/* Date Range Filter */}
            <div>
              <label className="block text-sm font-medium ui-text-secondary mb-2">
                Date Range
              </label>
              <div className="space-y-2">
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 ui-text-muted" />
                  <input
                    type="date"
                    placeholder="From date"
                    value={localFilters.dateRange.from?.toISOString().split('T')[0] || ''}
                    onChange={(e) => updateFilters({
                      dateRange: {
                        ...localFilters.dateRange,
                        from: e.target.value ? new Date(e.target.value) : undefined
                      }
                    })}
                    className="w-full pl-10 pr-4 py-2 text-sm border ui-border-light rounded-[var(--radius-sm)] ui-bg-tertiary"
                  />
                </div>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 ui-text-muted" />
                  <input
                    type="date"
                    placeholder="To date"
                    value={localFilters.dateRange.to?.toISOString().split('T')[0] || ''}
                    onChange={(e) => updateFilters({
                      dateRange: {
                        ...localFilters.dateRange,
                        to: e.target.value ? new Date(e.target.value) : undefined
                      }
                    })}
                    className="w-full pl-10 pr-4 py-2 text-sm border ui-border-light rounded-[var(--radius-sm)] ui-bg-tertiary"
                  />
                </div>
              </div>
            </div>

            {/* File Size Range Filter */}
            <div>
              <label className="block text-sm font-medium ui-text-secondary mb-2">
                File Size (bytes)
              </label>
              <div className="space-y-2">
                <input
                  type="number"
                  placeholder="Min size"
                  value={localFilters.sizeRange.min || ''}
                  onChange={(e) => updateFilters({
                    sizeRange: {
                      ...localFilters.sizeRange,
                      min: e.target.value ? parseInt(e.target.value) : undefined
                    }
                  })}
                  className="w-full px-3 py-2 text-sm border ui-border-light rounded-[var(--radius-sm)] ui-bg-tertiary"
                />
                <input
                  type="number"
                  placeholder="Max size"
                  value={localFilters.sizeRange.max || ''}
                  onChange={(e) => updateFilters({
                    sizeRange: {
                      ...localFilters.sizeRange,
                      max: e.target.value ? parseInt(e.target.value) : undefined
                    }
                  })}
                  className="w-full px-3 py-2 text-sm border ui-border-light rounded-[var(--radius-sm)] ui-bg-tertiary"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}