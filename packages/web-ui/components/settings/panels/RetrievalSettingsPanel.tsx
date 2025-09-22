'use client'

import { SettingField, SettingGroup } from '../SettingField'
import { SettingControl } from '../SettingControl'
import { useSettings } from '../SettingsProvider'

export function RetrievalSettingsPanel() {
  const { state, updateSetting } = useSettings()

  return (
    <div className="space-y-8">
      <SettingGroup
        title="Basic Retrieval"
        description="Fundamental settings for document retrieval and ranking"
      >
        <SettingField
          title="Final Passages"
          description="Number of passages to return in the final result"
        >
          <SettingControl
            type="slider"
            id="finalPassages"
            label="Final Passages"
            value={state.data.finalPassages}
            onChange={(value) => updateSetting('finalPassages', value)}
            min={1}
            max={50}
            step={1}
            formatValue={(value) => `${value} passages`}
            description="How many relevant passages to include in responses"
            error={state.validationErrors.finalPassages}
          />
        </SettingField>

        <SettingField
          title="Cosine Similarity Floor"
          description="Minimum similarity score for including passages"
        >
          <SettingControl
            type="slider"
            id="cosineFloor"
            label="Cosine Floor"
            value={state.data.cosineFloor}
            onChange={(value) => updateSetting('cosineFloor', value)}
            min={0}
            max={1}
            step={0.01}
            formatValue={(value) => value.toFixed(2)}
            description="Filter out passages below this similarity threshold"
            error={state.validationErrors.cosineFloor}
          />
        </SettingField>

        <SettingField
          title="Keyword Overlap"
          description="Minimum number of matching keywords between query and passage"
        >
          <SettingControl
            type="slider"
            id="minKeywordOverlap"
            label="Min Keyword Overlap"
            value={state.data.minKeywordOverlap}
            onChange={(value) => updateSetting('minKeywordOverlap', value)}
            min={0}
            max={10}
            step={1}
            formatValue={(value) => `${value} keywords`}
            description="Require passages to share at least this many keywords with the query"
            error={state.validationErrors.minKeywordOverlap}
          />
        </SettingField>
      </SettingGroup>

      <SettingGroup
        title="Advanced Retrieval"
        description="Fine-tune hybrid search parameters and ranking algorithms"
      >
        <SettingField
          title="Dense Retrieval K"
          description="Number of candidates from semantic similarity search"
        >
          <SettingControl
            type="slider"
            id="denseK"
            label="Dense K"
            value={state.data.denseK}
            onChange={(value) => updateSetting('denseK', value)}
            min={10}
            max={500}
            step={10}
            formatValue={(value) => `${value} candidates`}
            description="How many passages to retrieve using dense embeddings"
            error={state.validationErrors.denseK}
          />
        </SettingField>

        <SettingField
          title="Lexical Retrieval K"
          description="Number of candidates from keyword-based search"
        >
          <SettingControl
            type="slider"
            id="lexicalK"
            label="Lexical K"
            value={state.data.lexicalK}
            onChange={(value) => updateSetting('lexicalK', value)}
            min={10}
            max={500}
            step={10}
            formatValue={(value) => `${value} candidates`}
            description="How many passages to retrieve using keyword matching"
            error={state.validationErrors.lexicalK}
          />
        </SettingField>

        <SettingField
          title="RRF K Parameter"
          description="Reciprocal Rank Fusion parameter for combining search results"
        >
          <SettingControl
            type="slider"
            id="rrfK"
            label="RRF K"
            value={state.data.rrfK}
            onChange={(value) => updateSetting('rrfK', value)}
            min={1}
            max={100}
            step={1}
            formatValue={(value) => `${value}`}
            description="Controls how different ranking methods are combined"
            error={state.validationErrors.rrfK}
          />
        </SettingField>

        <SettingField
          title="MMR Lambda"
          description="Maximal Marginal Relevance parameter for diversity"
        >
          <SettingControl
            type="slider"
            id="mmrLambda"
            label="MMR Lambda"
            value={state.data.mmrLambda}
            onChange={(value) => updateSetting('mmrLambda', value)}
            min={0}
            max={1}
            step={0.1}
            formatValue={(value) => value.toFixed(1)}
            description="Balance between relevance (1.0) and diversity (0.0)"
            error={state.validationErrors.mmrLambda}
          />
        </SettingField>
      </SettingGroup>

      <SettingGroup
        title="Retrieval Features"
        description="Enable or disable advanced retrieval features"
      >
        <SettingField
          title="Reranker"
          description="Use a neural reranker to improve result quality"
        >
          <SettingControl
            type="toggle"
            id="useReranker"
            label="Enable Reranker"
            value={state.data.useReranker}
            onChange={(value) => updateSetting('useReranker', value)}
            description="Apply neural reranking to improve passage ordering"
            error={state.validationErrors.useReranker}
          />
        </SettingField>

        <SettingField
          title="Reranker Fallback"
          description="Continue processing if reranker is unavailable"
        >
          <SettingControl
            type="toggle"
            id="allowRerankerFallback"
            label="Allow Reranker Fallback"
            value={state.data.allowRerankerFallback}
            onChange={(value) => updateSetting('allowRerankerFallback', value)}
            description="Proceed without reranking if the reranker fails"
            error={state.validationErrors.allowRerankerFallback}
          />
        </SettingField>

        <SettingField
          title="RM3 Query Expansion"
          description="Use Relevance Model 3 for query expansion"
        >
          <SettingControl
            type="toggle"
            id="useRm3"
            label="Enable RM3"
            value={state.data.useRm3}
            onChange={(value) => updateSetting('useRm3', value)}
            description="Expand queries using terms from top retrieved documents"
            error={state.validationErrors.useRm3}
          />
        </SettingField>

        <SettingField
          title="Early Reranking"
          description="Apply reranking before final passage selection"
        >
          <SettingControl
            type="toggle"
            id="useEarlyReranker"
            label="Enable Early Reranker"
            value={state.data.useEarlyReranker}
            onChange={(value) => updateSetting('useEarlyReranker', value)}
            description="Rerank candidates before final passage selection"
            error={state.validationErrors.useEarlyReranker}
          />
        </SettingField>
      </SettingGroup>

      <SettingGroup
        title="Vector Database"
        description="Configuration for the ChromaDB vector database"
      >
        <SettingField
          title="Database Host"
          description="Hostname or IP address of the ChromaDB server"
        >
          <SettingControl
            type="text"
            id="chromaHost"
            label="ChromaDB Host"
            value={state.data.chromaHost}
            onChange={(value) => updateSetting('chromaHost', value)}
            placeholder="localhost"
            description="Address where ChromaDB is running"
            error={state.validationErrors.chromaHost}
          />
        </SettingField>

        <SettingField
          title="Database Port"
          description="Port number for the ChromaDB server"
        >
          <SettingControl
            type="number"
            id="chromaPort"
            label="ChromaDB Port"
            value={state.data.chromaPort}
            onChange={(value) => updateSetting('chromaPort', value)}
            min={1}
            max={65535}
            placeholder="8100"
            description="Port where ChromaDB is listening"
            error={state.validationErrors.chromaPort}
          />
        </SettingField>
      </SettingGroup>
    </div>
  )
}