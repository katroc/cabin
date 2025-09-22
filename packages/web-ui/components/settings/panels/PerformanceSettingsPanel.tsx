'use client'

import { SettingField, SettingGroup } from '../SettingField'
import { SettingControl } from '../SettingControl'
import { useSettings } from '../SettingsProvider'

export function PerformanceSettingsPanel() {
  const { state, updateSetting } = useSettings()

  return (
    <div className="space-y-8">
      <SettingGroup
        title="Embedding Cache"
        description="Configure caching for embedding vectors to improve performance"
      >
        <SettingField
          title="Cache Status"
          description="Enable or disable embedding caching"
        >
          <SettingControl
            type="toggle"
            id="embeddingCacheEnabled"
            label="Enable Embedding Cache"
            value={state.data.embeddingCacheEnabled}
            onChange={(value) => updateSetting('embeddingCacheEnabled', value)}
            description="Cache computed embeddings to avoid recomputation"
            error={state.validationErrors.embeddingCacheEnabled}
          />
        </SettingField>

        <SettingField
          title="Cache Size"
          description="Maximum number of embeddings to cache in memory"
        >
          <SettingControl
            type="slider"
            id="embeddingCacheMaxItems"
            label="Max Cache Items"
            value={state.data.embeddingCacheMaxItems}
            onChange={(value) => updateSetting('embeddingCacheMaxItems', value)}
            min={10}
            max={10000}
            step={10}
            formatValue={(value) => `${value.toLocaleString()} items`}
            description="Higher values use more memory but improve cache hit rate"
            error={state.validationErrors.embeddingCacheMaxItems}
          />
        </SettingField>

        <SettingField
          title="Cache TTL"
          description="Time-to-live for cached embeddings in seconds"
        >
          <SettingControl
            type="slider"
            id="embeddingCacheTtlSeconds"
            label="Cache TTL"
            value={state.data.embeddingCacheTtlSeconds}
            onChange={(value) => updateSetting('embeddingCacheTtlSeconds', value)}
            min={60}
            max={86400}
            step={60}
            formatValue={(value) => {
              const hours = Math.floor(value / 3600)
              const minutes = Math.floor((value % 3600) / 60)
              if (hours > 0) return `${hours}h ${minutes}m`
              return `${minutes}m`
            }}
            description="How long to keep embeddings in cache"
            error={state.validationErrors.embeddingCacheTtlSeconds}
          />
        </SettingField>
      </SettingGroup>

      <SettingGroup
        title="Document Processing"
        description="Configure how documents are chunked and processed"
      >
        <SettingField
          title="Chunk Size"
          description="Size of text chunks in tokens for processing"
        >
          <SettingControl
            type="slider"
            id="chunkSizeTokens"
            label="Chunk Size"
            value={state.data.chunkSizeTokens}
            onChange={(value) => updateSetting('chunkSizeTokens', value)}
            min={50}
            max={2000}
            step={25}
            formatValue={(value) => `${value} tokens`}
            description="Larger chunks preserve context but may be less precise"
            error={state.validationErrors.chunkSizeTokens}
          />
        </SettingField>

        <SettingField
          title="Chunk Stride"
          description="Overlap between consecutive chunks in tokens"
        >
          <SettingControl
            type="slider"
            id="chunkStrideTokens"
            label="Chunk Stride"
            value={state.data.chunkStrideTokens}
            onChange={(value) => updateSetting('chunkStrideTokens', value)}
            min={0}
            max={500}
            step={5}
            formatValue={(value) => `${value} tokens`}
            description="Overlap helps preserve information across chunk boundaries"
            error={state.validationErrors.chunkStrideTokens}
          />
        </SettingField>

        <SettingField
          title="HTML Character Limit"
          description="Maximum characters to process from HTML documents"
        >
          <SettingControl
            type="slider"
            id="maxHtmlChars"
            label="Max HTML Characters"
            value={state.data.maxHtmlChars}
            onChange={(value) => updateSetting('maxHtmlChars', value)}
            min={10000}
            max={10000000}
            step={10000}
            formatValue={(value) => {
              if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M chars`
              if (value >= 1000) return `${(value / 1000).toFixed(0)}K chars`
              return `${value} chars`
            }}
            description="Limits processing of very large HTML documents"
            error={state.validationErrors.maxHtmlChars}
          />
        </SettingField>
      </SettingGroup>

      <SettingGroup
        title="Reranker Performance"
        description="Configure reranker service performance and reliability"
      >
        <SettingField
          title="Reranker URL"
          description="URL endpoint for the reranker service"
        >
          <SettingControl
            type="url"
            id="rerankerUrl"
            label="Reranker URL"
            value={state.data.rerankerUrl}
            onChange={(value) => updateSetting('rerankerUrl', value)}
            placeholder="http://localhost:8002/rerank"
            description="Full URL to the reranker API endpoint"
            error={state.validationErrors.rerankerUrl}
          />
        </SettingField>

        <SettingField
          title="Reranker Port"
          description="Port number for the reranker service"
        >
          <SettingControl
            type="number"
            id="rerankerPort"
            label="Reranker Port"
            value={state.data.rerankerPort}
            onChange={(value) => updateSetting('rerankerPort', value)}
            min={1}
            max={65535}
            placeholder="8002"
            description="Port where the reranker service is listening"
            error={state.validationErrors.rerankerPort}
          />
        </SettingField>

        <SettingField
          title="Request Timeout"
          description="Maximum time to wait for reranker responses"
        >
          <SettingControl
            type="slider"
            id="rerankerTimeout"
            label="Reranker Timeout"
            value={state.data.rerankerTimeout}
            onChange={(value) => updateSetting('rerankerTimeout', value)}
            min={1}
            max={60}
            step={1}
            formatValue={(value) => `${value}s`}
            description="Timeout for reranker API calls"
            error={state.validationErrors.rerankerTimeout}
          />
        </SettingField>

        <SettingField
          title="Connection Pool Size"
          description="Multiplier for reranker connection pool size"
        >
          <SettingControl
            type="slider"
            id="rerankerPoolSizeMultiplier"
            label="Pool Size Multiplier"
            value={state.data.rerankerPoolSizeMultiplier}
            onChange={(value) => updateSetting('rerankerPoolSizeMultiplier', value)}
            min={1}
            max={10}
            step={1}
            formatValue={(value) => `${value}x`}
            description="Higher values allow more concurrent reranker requests"
            error={state.validationErrors.rerankerPoolSizeMultiplier}
          />
        </SettingField>

        <SettingField
          title="Score Weight"
          description="Weight of reranker scores in final ranking"
        >
          <SettingControl
            type="slider"
            id="rerankerScoreWeight"
            label="Reranker Score Weight"
            value={state.data.rerankerScoreWeight}
            onChange={(value) => updateSetting('rerankerScoreWeight', value)}
            min={0}
            max={1}
            step={0.1}
            formatValue={(value) => value.toFixed(1)}
            description="How much to weight reranker scores vs original scores"
            error={state.validationErrors.rerankerScoreWeight}
          />
        </SettingField>
      </SettingGroup>
    </div>
  )
}