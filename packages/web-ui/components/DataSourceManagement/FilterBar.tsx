'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, Filter, X, Calendar, FileText, Tag, ChevronDown, ChevronUp, Clock, Loader2 } from 'lucide-react'
import { FilterOptions } from './types'

interface FilterBarProps {
  filters: FilterOptions
  onFiltersChange: (filters: FilterOptions) => void
  availableSourceTypes: string[]
  availableStatuses: string[]
  availableContentTypes: string[]
  availableTags: string[]
  resultCount?: number
  isSearching?: boolean
}

const RECENT_SEARCHES_KEY = 'cabin_recent_searches'
const MAX_RECENT_SEARCHES = 5

export default function FilterBar({
  filters,
  onFiltersChange,
  availableSourceTypes,
  availableStatuses,
  availableContentTypes,
  availableTags,
  resultCount,
  isSearching = false
}: FilterBarProps) {
  const [localFilters, setLocalFilters] = useState<FilterOptions>(filters)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showRecentSearches, setShowRecentSearches] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_SEARCHES_KEY)
      if (saved) {
        setRecentSearches(JSON.parse(saved))
      }
    } catch (e) {
      console.error('Failed to load recent searches:', e)
    }
  }, [])

  useEffect(() => {
    setLocalFilters(filters)
  }, [filters])

  const saveRecentSearch = (search: string) => {
    if (!search.trim()) return
    const updated = [search, ...recentSearches.filter(s => s !== search)].slice(0, MAX_RECENT_SEARCHES)
    setRecentSearches(updated)
    try {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
    } catch (e) {
      console.error('Failed to save recent searches:', e)
    }
  }

  const handleSearchFocus = () => {
    if (recentSearches.length > 0 && !localFilters.search) {
      setShowRecentSearches(true)
    }
  }

  const handleSearchBlur = () => {
    setTimeout(() => setShowRecentSearches(false), 200)
  }

  const selectRecentSearch = (search: string) => {
    const updated = { ...localFilters, search }
    setLocalFilters(updated)
    onFiltersChange(updated)
    setShowRecentSearches(false)
  }

  const updateFilters = (newFilters: Partial<FilterOptions>) => {
    const updated = { ...localFilters, ...newFilters }
    setLocalFilters(updated)

    // Debounce search to avoid excessive updates
    if ('search' in newFilters) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      debounceRef.current = setTimeout(() => {
        onFiltersChange(updated)
        if (newFilters.search) {
          saveRecentSearch(newFilters.search)
        }
      }, 300)
    } else {
      onFiltersChange(updated)
    }
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
            {isSearching ? (
              <Loader2 className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 ui-text-muted animate-spin" />
            ) : (
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 ui-text-muted" />
            )}
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search documents by title, content, or metadata..."
              value={localFilters.search}
              onChange={(e) => updateFilters({ search: e.target.value })}
              onFocus={handleSearchFocus}
              onBlur={handleSearchBlur}
              className="w-full !pl-12 pr-20 py-3 border ui-border-light rounded-lg ui-bg-secondary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent btn-standard"
            />
            {/* Result count */}
            {resultCount !== undefined && localFilters.search && (
              <span className="absolute right-10 top-1/2 transform -translate-y-1/2 text-xs ui-text-muted">
                {resultCount} result{resultCount !== 1 ? 's' : ''}
              </span>
            )}
            {localFilters.search && (
              <button
                onClick={() => updateFilters({ search: '' })}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 ui-text-muted hover:ui-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* Recent Searches Dropdown */}
            {showRecentSearches && recentSearches.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 p-2 ui-bg-secondary border ui-border-light rounded-lg shadow-lg z-10">
                <div className="flex items-center gap-2 px-2 py-1 text-xs ui-text-muted mb-1">
                  <Clock className="w-3 h-3" />
                  Recent Searches
                </div>
                {recentSearches.map((search, index) => (
                  <button
                    key={index}
                    onClick={() => selectRecentSearch(search)}
                    className="w-full text-left px-3 py-2 text-sm ui-text-secondary hover:ui-bg-tertiary rounded-md transition-colors"
                  >
                    {search}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Filter Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`btn-secondary btn-small btn-standard ${showAdvanced ? 'ui-bg-tertiary' : ''}`}
          >
            <Filter className="w-4 h-4" />
            Advanced
            {showAdvanced ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
          </button>

          {hasActiveFilters() && (
            <button
              onClick={clearAllFilters}
              className="btn-secondary btn-small btn-standard"
            >
              <X className="w-4 h-4" />
              Clear All
            </button>
          )}


        </div>
      </div>

      {/* Advanced Filters */}
      {showAdvanced && (
        <div className="p-4 ui-bg-secondary border ui-border-faint rounded-lg space-y-4">
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
                  className="w-full px-3 py-2 text-sm border ui-border-light rounded-md ui-bg-tertiary btn-small"
                />
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
                  className="w-full px-3 py-2 text-sm border ui-border-light rounded-md ui-bg-tertiary btn-small"
                />
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
                  className="w-full px-3 py-2 text-sm border ui-border-light rounded-md ui-bg-tertiary btn-small"
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
                  className="w-full px-3 py-2 text-sm border ui-border-light rounded-md ui-bg-tertiary btn-small"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}