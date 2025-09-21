'use client'

import { useState, useEffect, useCallback } from 'react'

// Types for our cached data
interface CachedData<T> {
  data: T
  timestamp: number
  ttl: number
}

interface PerformanceDashboardState {
  // User preferences (always persisted)
  timeRange: string
  autoRefresh: boolean

  // Cached performance data (with TTL)
  summary: CachedData<any> | null
  componentStats: CachedData<any> | null
  vllmMetrics: CachedData<any> | null
  vllmHealth: CachedData<any> | null
  recentMetrics: CachedData<any> | null
}

const STORAGE_KEY = 'cabin.performance-dashboard.v1'
const CACHE_TTL_MS = 30000 // 30 seconds

// Utility functions for localStorage with error handling
const getStoredState = (): Partial<PerformanceDashboardState> => {
  if (typeof window === 'undefined') return {}

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch (error) {
    console.warn('Failed to load performance dashboard state:', error)
    return {}
  }
}

const setStoredState = (state: Partial<PerformanceDashboardState>) => {
  if (typeof window === 'undefined') return

  try {
    const currentState = getStoredState()
    const newState = { ...currentState, ...state }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newState))
  } catch (error) {
    console.warn('Failed to save performance dashboard state:', error)
  }
}

// Helper to check if cached data is still valid
const isCacheValid = <T>(cachedData: CachedData<T> | null): boolean => {
  if (!cachedData) return false
  return Date.now() - cachedData.timestamp < cachedData.ttl
}

// Helper to create cached data
const createCachedData = <T>(data: T, ttl: number = CACHE_TTL_MS): CachedData<T> => ({
  data,
  timestamp: Date.now(),
  ttl
})

export function usePerformanceDashboardState() {
  // Initialize state with defaults and stored values
  const [timeRange, setTimeRangeState] = useState<string>(() => {
    if (typeof window === 'undefined') return '1h'
    return getStoredState().timeRange || '1h'
  })

  const [autoRefresh, setAutoRefreshState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return getStoredState().autoRefresh !== false // Default to true
  })

  // Cached data state
  const [summary, setSummary] = useState<CachedData<any> | null>(() => {
    if (typeof window === 'undefined') return null
    const stored = getStoredState()
    return stored.summary && isCacheValid(stored.summary) ? stored.summary : null
  })

  const [componentStats, setComponentStats] = useState<CachedData<any> | null>(() => {
    if (typeof window === 'undefined') return null
    const stored = getStoredState()
    return stored.componentStats && isCacheValid(stored.componentStats) ? stored.componentStats : null
  })

  const [vllmMetrics, setVllmMetrics] = useState<CachedData<any> | null>(() => {
    if (typeof window === 'undefined') return null
    const stored = getStoredState()
    return stored.vllmMetrics && isCacheValid(stored.vllmMetrics) ? stored.vllmMetrics : null
  })

  const [vllmHealth, setVllmHealth] = useState<CachedData<any> | null>(() => {
    if (typeof window === 'undefined') return null
    const stored = getStoredState()
    return stored.vllmHealth && isCacheValid(stored.vllmHealth) ? stored.vllmHealth : null
  })

  const [recentMetrics, setRecentMetrics] = useState<CachedData<any> | null>(() => {
    if (typeof window === 'undefined') return null
    const stored = getStoredState()
    return stored.recentMetrics && isCacheValid(stored.recentMetrics) ? stored.recentMetrics : null
  })

  // Persist user preferences to localStorage
  useEffect(() => {
    setStoredState({ timeRange, autoRefresh })
  }, [timeRange, autoRefresh])

  // Helper functions to check cache validity
  const isSummaryValid = useCallback(() => isCacheValid(summary), [summary])
  const isComponentStatsValid = useCallback(() => isCacheValid(componentStats), [componentStats])
  const isVllmMetricsValid = useCallback(() => isCacheValid(vllmMetrics), [vllmMetrics])
  const isVllmHealthValid = useCallback(() => isCacheValid(vllmHealth), [vllmHealth])
  const isRecentMetricsValid = useCallback(() => isCacheValid(recentMetrics), [recentMetrics])

  // Helper functions to get cached data (or null if invalid)
  const getCachedSummary = useCallback(() => summary && isCacheValid(summary) ? summary.data : null, [summary])
  const getCachedComponentStats = useCallback(() => componentStats && isCacheValid(componentStats) ? componentStats.data : null, [componentStats])
  const getCachedVllmMetrics = useCallback(() => vllmMetrics && isCacheValid(vllmMetrics) ? vllmMetrics.data : null, [vllmMetrics])
  const getCachedVllmHealth = useCallback(() => vllmHealth && isCacheValid(vllmHealth) ? vllmHealth.data : null, [vllmHealth])
  const getCachedRecentMetrics = useCallback(() => recentMetrics && isCacheValid(recentMetrics) ? recentMetrics.data : null, [recentMetrics])

  // Helper functions to cache new data
  const cacheSummary = useCallback((data: any) => {
    const cached = createCachedData(data)
    setSummary(cached)
    setStoredState({ summary: cached })
  }, [])

  const cacheComponentStats = useCallback((data: any) => {
    const cached = createCachedData(data)
    setComponentStats(cached)
    setStoredState({ componentStats: cached })
  }, [])

  const cacheVllmMetrics = useCallback((data: any) => {
    const cached = createCachedData(data)
    setVllmMetrics(cached)
    setStoredState({ vllmMetrics: cached })
  }, [])

  const cacheVllmHealth = useCallback((data: any) => {
    const cached = createCachedData(data)
    setVllmHealth(cached)
    setStoredState({ vllmHealth: cached })
  }, [])

  const cacheRecentMetrics = useCallback((data: any) => {
    const cached = createCachedData(data)
    setRecentMetrics(cached)
    setStoredState({ recentMetrics: cached })
  }, [])

  // Helper to clear all cached data
  const clearCache = useCallback(() => {
    setSummary(null)
    setComponentStats(null)
    setVllmMetrics(null)
    setVllmHealth(null)
    setRecentMetrics(null)
    setStoredState({
      summary: null,
      componentStats: null,
      vllmMetrics: null,
      vllmHealth: null,
      recentMetrics: null
    })
  }, [])

  return {
    // User preferences
    timeRange,
    setTimeRange: setTimeRangeState,
    autoRefresh,
    setAutoRefresh: setAutoRefreshState,

    // Cached data getters
    summary: getCachedSummary(),
    componentStats: getCachedComponentStats(),
    vllmMetrics: getCachedVllmMetrics(),
    vllmHealth: getCachedVllmHealth(),
    recentMetrics: getCachedRecentMetrics(),

    // Cache validity checkers
    isSummaryValid: isSummaryValid(),
    isComponentStatsValid: isComponentStatsValid(),
    isVllmMetricsValid: isVllmMetricsValid(),
    isVllmHealthValid: isVllmHealthValid(),
    isRecentMetricsValid: isRecentMetricsValid(),

    // Cache management
    cacheSummary,
    cacheComponentStats,
    cacheVllmMetrics,
    cacheVllmHealth,
    cacheRecentMetrics,
    clearCache
  }
}