'use client'

import { useState, useCallback } from 'react'
import { SettingField, SettingGroup } from '../SettingField'
import { SettingControl } from '../SettingControl'
import { useSettings } from '../SettingsProvider'

interface DiscoveredModel {
  id: string
  name: string
  service: string
  url: string
  type: string
  status: string
}

interface ModelDiscoveryResponse {
  models: DiscoveredModel[]
  service_status: Record<string, string>
  timestamp: string
  total_models_found: number
}

export function AIModelsSettingsPanel() {
  const { state, updateSetting } = useSettings()
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([])
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [lastDiscoveryTime, setLastDiscoveryTime] = useState<string | null>(null)

  const discoverModels = useCallback(async () => {
    setIsDiscovering(true)
    setDiscoveryError(null)

    try {
      const response = await fetch('http://localhost:8788/api/models/discover')
      if (!response.ok) {
        throw new Error(`Discovery failed: ${response.status}`)
      }

      const data: ModelDiscoveryResponse = await response.json()
      setDiscoveredModels(data.models)
      setLastDiscoveryTime(data.timestamp)

      // Auto-select discovered models if current settings are still defaults
      const languageModels = data.models.filter(m => m.type === 'language_model')
      const embeddingModels = data.models.filter(m => m.type === 'embedding_model')

      if (languageModels.length > 0) {
        const currentLlmModel = state.data.llmModel
        // If current model is empty or a known default, use discovered model
        if (!currentLlmModel || currentLlmModel === 'openai/gpt-oss-20b' || currentLlmModel === 'local-model') {
          updateSetting('llmModel', languageModels[0].id)
          updateSetting('llmBaseUrl', languageModels[0].url + '/v1')
        }
      }

      if (embeddingModels.length > 0) {
        const currentEmbeddingModel = state.data.embeddingModel
        // If current model is empty or a known default, use discovered model
        if (!currentEmbeddingModel || currentEmbeddingModel === 'text-embedding-bge-m3' || currentEmbeddingModel === 'bge-m3') {
          updateSetting('embeddingModel', embeddingModels[0].id)
          updateSetting('embeddingBaseUrl', embeddingModels[0].url + '/v1')
        }
      }

    } catch (error) {
      setDiscoveryError(error instanceof Error ? error.message : 'Failed to discover models')
    } finally {
      setIsDiscovering(false)
    }
  }, [state.data.llmModel, state.data.embeddingModel, updateSetting])

  // Get available models for dropdowns
  const languageModelOptions = discoveredModels
    .filter(m => m.type === 'language_model')
    .map(m => ({ value: m.id, label: `${m.id} (${m.service})` }))

  const embeddingModelOptions = discoveredModels
    .filter(m => m.type === 'embedding_model')
    .map(m => ({ value: m.id, label: `${m.id} (${m.service})` }))

  return (
    <div className="space-y-8">
      <SettingGroup
        title="Model Discovery"
        description="Automatically discover available models from running vLLM containers"
      >
        <SettingField
          title="Discover Models"
          description="Scan for available models in your vLLM containers"
        >
          <div className="space-y-3">
            <button
              onClick={discoverModels}
              disabled={isDiscovering}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDiscovering ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Discovering...
                </>
              ) : (
                <>
                  🔍 Discover Models
                </>
              )}
            </button>

            {discoveryError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {discoveryError}
              </div>
            )}

            {discoveredModels.length > 0 && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
                ✅ Found {discoveredModels.length} model(s)
                {lastDiscoveryTime && ` at ${new Date(lastDiscoveryTime).toLocaleTimeString()}`}
              </div>
            )}
          </div>
        </SettingField>
      </SettingGroup>

      <SettingGroup
        title="LLM Provider"
        description="Configure the language model provider for text generation"
      >
        <SettingField
          title="Base URL"
          description="The base URL for the LLM API endpoint"
        >
          <SettingControl
            type="url"
            id="llmBaseUrl"
            label="LLM Base URL"
            value={state.data.llmBaseUrl}
            onChange={(value) => updateSetting('llmBaseUrl', value)}
            placeholder="http://localhost:1234/v1"
            description="URL to your LLM API server"
            error={state.validationErrors.llmBaseUrl}
          />
        </SettingField>

        <SettingField
          title="Model"
          description="The specific model to use for text generation"
        >
          {languageModelOptions.length > 0 ? (
            <SettingControl
              type="select"
              id="llmModel"
              label="LLM Model"
              value={state.data.llmModel}
              onChange={(value) => {
                updateSetting('llmModel', value)
                // Auto-update base URL when model is selected
                const selectedModel = discoveredModels.find(m => m.id === value)
                if (selectedModel) {
                  updateSetting('llmBaseUrl', selectedModel.url + '/v1')
                }
              }}
              options={languageModelOptions}
              description="Select from discovered models"
              error={state.validationErrors.llmModel}
            />
          ) : (
            <SettingControl
              type="text"
              id="llmModel"
              label="LLM Model"
              value={state.data.llmModel}
              onChange={(value) => updateSetting('llmModel', value)}
              placeholder="e.g. Qwen3-4B-Instruct-2507"
              description="Model identifier or name (discover models above for dropdown)"
              error={state.validationErrors.llmModel}
            />
          )}
        </SettingField>

        <SettingField
          title="API Key"
          description="Authentication key for the LLM provider (if required)"
        >
          <SettingControl
            type="password"
            id="llmApiKey"
            label="LLM API Key"
            value={state.data.llmApiKey}
            onChange={(value) => updateSetting('llmApiKey', value)}
            placeholder="sk-..."
            description="Leave empty if not required"
            error={state.validationErrors.llmApiKey}
          />
        </SettingField>

        <SettingField
          title="Temperature"
          description="Controls randomness in text generation"
        >
          <SettingControl
            type="slider"
            id="temperature"
            label="Temperature"
            value={state.data.temperature}
            onChange={(value) => updateSetting('temperature', value)}
            min={0}
            max={2}
            step={0.1}
            formatValue={(value) => value.toFixed(1)}
            description="Higher values make output more random, lower values more focused"
            error={state.validationErrors.temperature}
          />
        </SettingField>
      </SettingGroup>

      <SettingGroup
        title="Embedding Provider"
        description="Configure the embedding model provider for text vectorization"
      >
        <SettingField
          title="Base URL"
          description="The base URL for the embedding API endpoint"
        >
          <SettingControl
            type="url"
            id="embeddingBaseUrl"
            label="Embedding Base URL"
            value={state.data.embeddingBaseUrl}
            onChange={(value) => updateSetting('embeddingBaseUrl', value)}
            placeholder="http://localhost:1234/v1"
            description="URL to your embedding API server"
            error={state.validationErrors.embeddingBaseUrl}
          />
        </SettingField>

        <SettingField
          title="Model"
          description="The specific model to use for text embeddings"
        >
          {embeddingModelOptions.length > 0 ? (
            <SettingControl
              type="select"
              id="embeddingModel"
              label="Embedding Model"
              value={state.data.embeddingModel}
              onChange={(value) => {
                updateSetting('embeddingModel', value)
                // Auto-update base URL when model is selected
                const selectedModel = discoveredModels.find(m => m.id === value)
                if (selectedModel) {
                  updateSetting('embeddingBaseUrl', selectedModel.url + '/v1')
                }
              }}
              options={embeddingModelOptions}
              description="Select from discovered models"
              error={state.validationErrors.embeddingModel}
            />
          ) : (
            <SettingControl
              type="text"
              id="embeddingModel"
              label="Embedding Model"
              value={state.data.embeddingModel}
              onChange={(value) => updateSetting('embeddingModel', value)}
              placeholder="e.g. bge-m3"
              description="Embedding model identifier (discover models above for dropdown)"
              error={state.validationErrors.embeddingModel}
            />
          )}
        </SettingField>

        <SettingField
          title="API Key"
          description="Authentication key for the embedding provider (if required)"
        >
          <SettingControl
            type="password"
            id="embeddingApiKey"
            label="Embedding API Key"
            value={state.data.embeddingApiKey}
            onChange={(value) => updateSetting('embeddingApiKey', value)}
            placeholder="sk-..."
            description="Leave empty if not required"
            error={state.validationErrors.embeddingApiKey}
          />
        </SettingField>

        <SettingField
          title="Dimensions"
          description="Number of dimensions in the embedding vectors"
        >
          <SettingControl
            type="number"
            id="embeddingDimensions"
            label="Embedding Dimensions"
            value={state.data.embeddingDimensions}
            onChange={(value) => updateSetting('embeddingDimensions', value)}
            min={64}
            max={4096}
            placeholder="256"
            description="Must match your embedding model's output dimensions"
            error={state.validationErrors.embeddingDimensions}
          />
        </SettingField>

        <SettingField
          title="Batch Size"
          description="Number of texts to process in a single embedding request"
        >
          <SettingControl
            type="slider"
            id="embeddingBatchSize"
            label="Embedding Batch Size"
            value={state.data.embeddingBatchSize}
            onChange={(value) => updateSetting('embeddingBatchSize', value)}
            min={1}
            max={100}
            step={1}
            formatValue={(value) => `${value} texts`}
            description="Higher values improve throughput but use more memory"
            error={state.validationErrors.embeddingBatchSize}
          />
        </SettingField>
      </SettingGroup>

      <SettingGroup
        title="Generation Settings"
        description="Control text generation behavior and limits"
      >
        <SettingField
          title="Max Tokens"
          description="Maximum number of tokens for standard responses"
        >
          <SettingControl
            type="slider"
            id="maxTokens"
            label="Max Tokens"
            value={state.data.maxTokens}
            onChange={(value) => updateSetting('maxTokens', value)}
            min={100}
            max={50000}
            step={100}
            formatValue={(value) => `${value.toLocaleString()} tokens`}
            description="Controls the maximum length of generated responses"
            error={state.validationErrors.maxTokens}
          />
        </SettingField>

        <SettingField
          title="Streaming Max Tokens"
          description="Maximum number of tokens for streaming responses"
        >
          <SettingControl
            type="slider"
            id="streamingMaxTokens"
            label="Streaming Max Tokens"
            value={state.data.streamingMaxTokens}
            onChange={(value) => updateSetting('streamingMaxTokens', value)}
            min={100}
            max={50000}
            step={100}
            formatValue={(value) => `${value.toLocaleString()} tokens`}
            description="Controls the maximum length of streaming responses"
            error={state.validationErrors.streamingMaxTokens}
          />
        </SettingField>

        <SettingField
          title="Rephrasing Max Tokens"
          description="Maximum number of tokens for query rephrasing"
        >
          <SettingControl
            type="slider"
            id="rephrasingMaxTokens"
            label="Rephrasing Max Tokens"
            value={state.data.rephrasingMaxTokens}
            onChange={(value) => updateSetting('rephrasingMaxTokens', value)}
            min={50}
            max={10000}
            step={50}
            formatValue={(value) => `${value.toLocaleString()} tokens`}
            description="Controls the maximum length of rephrased queries"
            error={state.validationErrors.rephrasingMaxTokens}
          />
        </SettingField>

        <SettingField
          title="Citations"
          description="Configure how citations are included in responses"
        >
          <SettingControl
            type="slider"
            id="maxCitations"
            label="Max Citations"
            value={state.data.maxCitations}
            onChange={(value) => updateSetting('maxCitations', value)}
            min={0}
            max={20}
            step={1}
            formatValue={(value) => `${value} citations`}
            description="Maximum number of source citations to include"
            error={state.validationErrors.maxCitations}
          />
        </SettingField>

        <SettingField
          title="Quote Requirements"
          description="Control how quotes are handled in responses"
        >
          <SettingControl
            type="toggle"
            id="requireQuotes"
            label="Require Quotes"
            value={state.data.requireQuotes}
            onChange={(value) => updateSetting('requireQuotes', value)}
            description="Require direct quotes from sources in responses"
            error={state.validationErrors.requireQuotes}
          />
        </SettingField>

        <SettingField
          title="Quote Length"
          description="Maximum length of individual quotes"
        >
          <SettingControl
            type="slider"
            id="quoteMaxWords"
            label="Quote Max Words"
            value={state.data.quoteMaxWords}
            onChange={(value) => updateSetting('quoteMaxWords', value)}
            min={5}
            max={100}
            step={1}
            formatValue={(value) => `${value} words`}
            description="Maximum number of words in a single quote"
            error={state.validationErrors.quoteMaxWords}
          />
        </SettingField>
      </SettingGroup>
    </div>
  )
}