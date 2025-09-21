'use client'

import { useEffect, useState } from 'react'
import {
  Activity,
  X,
  RefreshCw,
  Clock,
  Zap,
  Database,
  BarChart,
  Server,
  TrendingUp
} from 'lucide-react'

interface ComponentTiming {
  component: string
  duration_ms: number
  success: boolean
  error_message?: string
  metadata: Record<string, any>
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
  }
}

interface VLLMHealth {
  [serviceName: string]: boolean
}

interface PerformanceDashboardProps {
  isOpen: boolean
  onClose: () => void
}

export default function PerformanceDashboard({ isOpen, onClose }: PerformanceDashboardProps) {
  const [summary, setSummary] = useState<PerformanceSummary | null>(null)
  const [recentMetrics, setRecentMetrics] = useState<RAGPerformanceMetrics[]>([])
  const [componentStats, setComponentStats] = useState<Record<string, ComponentStats>>({})
  const [vllmMetrics, setVllmMetrics] = useState<VLLMMetrics | null>(null)
  const [vllmHealth, setVllmHealth] = useState<VLLMHealth | null>(null)
  const [loading, setLoading] = useState(false)
  const [timeRange, setTimeRange] = useState('1h')
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchPerformanceData = async () => {
    if (!isOpen) return

    setLoading(true)
    try {
      // Fetch summary data
      const summaryResponse = await fetch(`http://localhost:8788/api/performance/summary`)
      if (summaryResponse.ok) {
        const summaryData = await summaryResponse.json()
        setSummary(summaryData)
      }

      // Fetch recent metrics
      try {
        const metricsResponse = await fetch(`http://localhost:8788/api/performance/metrics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 20 })
        })
        if (metricsResponse.ok) {
          const metricsData = await metricsResponse.json()
          setRecentMetrics(metricsData.metrics || [])
        } else {
          console.warn('Failed to fetch performance metrics:', metricsResponse.status)
        }
      } catch (error) {
        console.warn('Error fetching performance metrics:', error)
        // Continue with other data even if this fails
      }

      // Fetch component breakdown
      try {
        const componentResponse = await fetch(`http://localhost:8788/api/performance/components`)
        if (componentResponse.ok) {
          const componentData = await componentResponse.json()
          setComponentStats(componentData.components || {})
        }
      } catch (error) {
        console.warn('Error fetching component stats:', error)
      }

      // Fetch vLLM metrics
      try {
        const vllmMetricsResponse = await fetch(`http://localhost:8788/api/performance/vllm`)
        if (vllmMetricsResponse.ok) {
          const vllmData = await vllmMetricsResponse.json()
          console.log('vLLM metrics received:', vllmData)
          setVllmMetrics(vllmData)
        }
      } catch (error) {
        console.warn('Error fetching vLLM metrics:', error)
      }

      // Fetch vLLM health
      try {
        const healthResponse = await fetch(`http://localhost:8788/api/performance/vllm/health`)
        if (healthResponse.ok) {
          const healthData = await healthResponse.json()
          setVllmHealth(healthData)
        }
      } catch (error) {
        console.warn('Error fetching vLLM health:', error)
      }

    } catch (error) {
      console.error('Error fetching performance data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      fetchPerformanceData()
    }
  }, [isOpen])

  useEffect(() => {
    if (!autoRefresh || !isOpen) return

    const interval = setInterval(fetchPerformanceData, 5000) // Refresh every 5 seconds
    return () => clearInterval(interval)
  }, [autoRefresh, isOpen])

  if (!isOpen) return null

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel fixed right-0 top-0 h-full w-full max-w-6xl flex flex-col">
        {/* Header */}
        <div className="drawer-header flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <h2 className="drawer-title">
            <Activity className="w-5 h-5 ui-text-secondary" />
            Performance Dashboard
          </h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="label-inline">Auto Refresh:</label>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="cursor-pointer"
              />
            </div>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="input-base max-w-[140px]"
            >
              <option value="1h">Last Hour</option>
              <option value="6h">Last 6 Hours</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
            </select>
            <button onClick={onClose} className="btn-close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 ui-bg-secondary" onClick={(e) => e.stopPropagation()}>
          {loading && (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
              <span className="ml-2 ui-text-secondary">Loading performance data...</span>
            </div>
          )}

          {!loading && (
            <div className="space-y-8">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="ui-bg-tertiary p-6 rounded-lg border ui-border-faint">
                  <div className="flex items-center gap-3 mb-2">
                    <Clock className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                    <h3 className="text-sm font-medium ui-text-secondary">Avg Response Time</h3>
                  </div>
                  <div className="text-2xl font-bold ui-text-primary">
                    {summary ? `${summary.avg_total_duration_ms.toFixed(0)}ms` : 'N/A'}
                  </div>
                  <div className="text-xs ui-text-muted mt-1">
                    {summary ? `${summary.total_requests} requests` : 'No data'}
                  </div>
                </div>

                <div className="ui-bg-tertiary p-6 rounded-lg border ui-border-faint">
                  <div className="flex items-center gap-3 mb-2">
                    <Zap className="w-5 h-5" style={{ color: 'var(--warning)' }} />
                    <h3 className="text-sm font-medium ui-text-secondary">Slowest Component</h3>
                  </div>
                  <div className="text-lg font-bold ui-text-primary capitalize">
                    {summary?.slowest_component_avg?.replace(/_/g, ' ') || 'N/A'}
                  </div>
                  <div className="text-xs ui-text-muted mt-1">
                    {summary?.slowest_component_avg ?
                      `${summary.avg_component_durations[summary.slowest_component_avg]?.toFixed(0)}ms avg` :
                      'No data'
                    }
                  </div>
                </div>

                <div className="ui-bg-tertiary p-6 rounded-lg border ui-border-faint">
                  <div className="flex items-center gap-3 mb-2">
                    <Database className="w-5 h-5" style={{ color: 'var(--success)' }} />
                    <h3 className="text-sm font-medium ui-text-secondary">RAG Usage</h3>
                  </div>
                  <div className="text-2xl font-bold ui-text-primary">
                    {summary ? `${summary.rag_request_percentage.toFixed(0)}%` : 'N/A'}
                  </div>
                  <div className="text-xs ui-text-muted mt-1">
                    {summary ? 'of requests use RAG' : 'No data'}
                  </div>
                </div>

                <div className="ui-bg-tertiary p-6 rounded-lg border ui-border-faint">
                  <div className="flex items-center gap-3 mb-2">
                    <Activity className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                    <h3 className="text-sm font-medium ui-text-secondary">vLLM Status</h3>
                  </div>
                  <div className="text-lg font-bold ui-text-primary">
                    {vllmHealth ?
                      `${Object.values(vllmHealth).filter(Boolean).length}/${Object.keys(vllmHealth).length} Healthy` :
                      'Checking...'
                    }
                  </div>
                  <div className="text-xs ui-text-muted mt-1">
                    Services status
                  </div>
                </div>
              </div>

              {/* Component Breakdown */}
              <div className="ui-bg-tertiary p-6 rounded-lg border ui-border-faint">
                <h3 className="text-lg font-semibold ui-text-primary mb-4 flex items-center gap-2">
                  <BarChart className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                  Component Performance Breakdown
                </h3>
                {summary && Object.keys(summary.avg_component_durations).length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(summary.avg_component_durations)
                      .sort(([,a], [,b]) => b - a)
                      .map(([component, duration]) => {
                        const percentage = (duration / summary.avg_total_duration_ms) * 100
                        return (
                          <div key={component} className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-sm ui-text-secondary capitalize">
                                {component.replace(/_/g, ' ')}
                              </span>
                              <span className="text-sm ui-text-muted">
                                {duration.toFixed(1)}ms ({percentage.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="w-full ui-bg-secondary rounded-full h-2">
                              <div
                                className="h-2 rounded-full transition-all duration-500"
                                style={{
                                  width: `${percentage}%`,
                                  background: 'var(--accent)'
                                }}
                              />
                            </div>
                          </div>
                        )
                      })
                    }
                  </div>
                ) : (
                  <p className="ui-text-muted text-center py-8">No component performance data available</p>
                )}
              </div>

              {/* vLLM Metrics */}
              <div className="ui-bg-tertiary p-6 rounded-lg border ui-border-faint">
                <h3 className="text-lg font-semibold ui-text-primary mb-4 flex items-center gap-2">
                  <Server className="w-5 h-5" style={{ color: 'var(--success)' }} />
                  vLLM Service Metrics
                </h3>
                {vllmMetrics && Object.keys(vllmMetrics).length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.entries(vllmMetrics).map(([serviceName, metrics]) => (
                      <div key={serviceName} className="ui-bg-secondary p-4 rounded border ui-border-light">
                        <div className="flex items-center gap-2 mb-3">
                          <div className={`w-2 h-2 rounded-full`} style={{
                            backgroundColor: vllmHealth?.[serviceName] ? 'var(--success)' : 'var(--error)'
                          }} />
                          <h4 className="font-medium ui-text-primary capitalize">{serviceName}</h4>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="ui-text-muted">Requests Running:</span>
                            <span className="ui-text-primary">{metrics.num_requests_running || 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="ui-text-muted">Requests Waiting:</span>
                            <span className="ui-text-primary">{metrics.num_requests_waiting || 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="ui-text-muted">GPU Cache Usage:</span>
                            <span className="ui-text-primary">{(metrics.gpu_cache_usage_perc || 0).toFixed(1)}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="ui-text-muted">Tokens/sec:</span>
                            <span className="ui-text-primary">{(metrics.tokens_per_second || 0).toFixed(1)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="ui-text-muted">Avg Latency:</span>
                            <span className="ui-text-primary">{((metrics.e2e_request_latency_seconds || 0) * 1000).toFixed(0)}ms</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="ui-text-muted text-center py-8">No vLLM metrics available</p>
                )}
              </div>

              {/* Recent Requests */}
              {recentMetrics.length > 0 && (
                <div className="ui-bg-tertiary p-6 rounded-lg border ui-border-faint">
                  <h3 className="text-lg font-semibold ui-text-primary mb-4 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                    Recent Requests
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b ui-border-light">
                          <th className="text-left py-2 ui-text-secondary">Query</th>
                          <th className="text-left py-2 ui-text-secondary">Duration</th>
                          <th className="text-left py-2 ui-text-secondary">Type</th>
                          <th className="text-left py-2 ui-text-secondary">Components</th>
                          <th className="text-left py-2 ui-text-secondary">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentMetrics.slice(0, 10).map((metric) => (
                          <tr key={metric.request_id} className="border-b ui-border-faint">
                            <td className="py-2 ui-text-primary max-w-xs truncate">
                              {metric.query}
                            </td>
                            <td className="py-2" style={{ color: 'var(--warning)' }}>
                              {metric.total_duration_ms.toFixed(0)}ms
                            </td>
                            <td className="py-2">
                              <span className={`px-2 py-1 rounded text-xs ${
                                metric.used_rag ? 'ui-bg-secondary' : 'ui-bg-tertiary'
                              }`} style={{
                                color: metric.used_rag ? 'var(--success)' : 'var(--accent)',
                                border: `1px solid ${metric.used_rag ? 'var(--success)' : 'var(--accent)'}`
                              }}>
                                {metric.used_rag ? 'RAG' : 'Direct'}
                              </span>
                            </td>
                            <td className="py-2 ui-text-muted">
                              {metric.component_timings?.length || 0}
                            </td>
                            <td className="py-2 ui-text-muted">
                              {new Date(metric.timestamp).toLocaleTimeString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}