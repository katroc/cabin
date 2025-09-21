'use client'

import { useState, useEffect, useCallback } from 'react'

// Import types from the PerformanceDashboard component
interface PerformanceSummary {
  total_requests: number
  avg_total_duration_ms: number
  avg_component_durations: Record<string, number>
  rag_request_percentage: number
  most_common_bottleneck?: string
  slowest_component_avg?: string
  time_period_start: string
  time_period_end: string
}

interface ComponentStats {
  avg_duration_ms: number
  total_calls: number
  success_rate: number
  max_duration_ms: number
  min_duration_ms: number
}

interface VLLMMetrics {
  [serviceName: string]: {
    num_requests_running: number
    num_requests_waiting: number
    num_requests_swapped: number
    time_to_first_token_seconds: number
    time_per_output_token_seconds: number
    e2e_request_latency_seconds: number
    prompt_tokens_total: number
    generation_tokens_total: number
    tokens_per_second: number
    gpu_cache_usage_perc: number
    gpu_memory_usage: number
    model_name: string
    timestamp: string
    metrics_available: boolean
  }
}

interface VLLMHealth {
  [serviceName: string]: boolean
}

interface RAGPerformanceMetrics {
  request_id: string
  conversation_id: string
  query: string
  query_type: string
  total_duration_ms: number
  used_rag: boolean
  num_context_chunks: number
  routing_similarity_score?: number
  routing_reason?: string
  timestamp: string
  user_agent?: string
  filters_applied?: any
  component_timings: ComponentTiming[]
}

interface ComponentTiming {
  component: string
  duration_ms: number
  success: boolean
  error_message?: string
  metadata: Record<string, any>
}

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
  summary: CachedData<PerformanceSummary> | null
  componentStats: CachedData<Record<string, ComponentStats>> | null
  vllmMetrics: CachedData<VLLMMetrics> | null
  vllmHealth: CachedData<VLLMHealth> | null
  recentMetrics: CachedData<RAGPerformanceMetrics[]> | null
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

  // Helper functions to get cached data (or default values if invalid)
  const getCachedSummary = useCallback(() => summary && isCacheValid(summary) ? summary.data : null, [summary])
  const getCachedComponentStats = useCallback(() => componentStats && isCacheValid(componentStats) ? componentStats.data : {}, [componentStats])
  const getCachedVllmMetrics = useCallback(() => vllmMetrics && isCacheValid(vllmMetrics) ? vllmMetrics.data : null, [vllmMetrics])
  const getCachedVllmHealth = useCallback(() => vllmHealth && isCacheValid(vllmHealth) ? vllmHealth.data : {}, [vllmHealth])
  const getCachedRecentMetrics = useCallback(() => recentMetrics && isCacheValid(recentMetrics) ? recentMetrics.data : [], [recentMetrics])

  // Helper functions to cache new data
  const cacheSummary = useCallback((data: PerformanceSummary) => {
    const cached = createCachedData(data)
    setSummary(cached)
    setStoredState({ summary: cached })
  }, [])

  const cacheComponentStats = useCallback((data: Record<string, ComponentStats>) => {
    const cached = createCachedData(data)
    setComponentStats(cached)
    setStoredState({ componentStats: cached })
  }, [])

  const cacheVllmMetrics = useCallback((data: VLLMMetrics) => {
    const cached = createCachedData(data)
    setVllmMetrics(cached)
    setStoredState({ vllmMetrics: cached })
  }, [])

  const cacheVllmHealth = useCallback((data: VLLMHealth) => {
    const cached = createCachedData(data)
    setVllmHealth(cached)
    setStoredState({ vllmHealth: cached })
  }, [])

  const cacheRecentMetrics = useCallback((data: RAGPerformanceMetrics[]) => {
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