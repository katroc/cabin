'use client'

import { SettingField, SettingGroup } from '../SettingField'
import { SettingControl } from '../SettingControl'
import { useSettings } from '../SettingsProvider'

export function AIModelsSettingsPanel() {
  const { state, updateSetting } = useSettings()

  return (
    <div className="space-y-8">
      <SettingGroup
        title="Model Information"
        description="Currently configured models (auto-discovered from running containers)"
      >
        <SettingField
          title="LLM Model"
          description="Language model used for text generation"
        >
          <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
            {state.data.llmModel || 'Auto-discovering...'}
          </div>
        </SettingField>

        <SettingField
          title="Embedding Model"
          description="Model used for text embeddings and semantic search"
        >
          <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
            {state.data.embeddingModel || 'Auto-discovering...'}
          </div>
        </SettingField>

        <SettingField
          title="Reranker Model"
          description="Model used for result reranking and relevance scoring"
        >
          <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
            bge-reranker-v2-m3
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