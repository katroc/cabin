
import type { RagConfig } from '../hooks/useSettings';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  space: string;
  setSpace: (value: string) => void;
  labels: string;
  setLabels: (value: string) => void;
  topK: number;
  setTopK: (value: number) => void;
  temperature: number;
  setTemperature: (value: number) => void;
  selectedModel: string;
  setSelectedModel: (value: string) => void;
  availableModels: Array<{id: string, object: string}>;
  ragConfig: RagConfig;
  setRagConfig: (config: RagConfig) => void;
  maxTokens: number;
  setMaxTokens: (value: number) => void;
  streamingMaxTokens: number;
  setStreamingMaxTokens: (value: number) => void;
  rephrasingMaxTokens: number;
  setRephrasingMaxTokens: (value: number) => void;
  crawlerAllSpaces: boolean;
  setCrawlerAllSpaces: (value: boolean) => void;
  crawlerSpaces: string;
  setCrawlerSpaces: (value: string) => void;
  crawlerPageSize: number;
  setCrawlerPageSize: (value: number) => void;
  crawlerMaxPages: number;
  setCrawlerMaxPages: (value: number) => void;
  crawlerConcurrency: number;
  setCrawlerConcurrency: (value: number) => void;
  availableSpaces: string[];
  refreshSpaces: () => void;
  saveCrawlerConfig: () => void;
  triggerSync: () => void;
  saveRagConfig: () => void;
}

export function SettingsDrawer({
  isOpen,
  onClose,
  space,
  setSpace,
  labels,
  setLabels,
  topK,
  setTopK,
  temperature,
  setTemperature,
  selectedModel,
  setSelectedModel,
  availableModels,
  ragConfig,
  setRagConfig,
  maxTokens,
  setMaxTokens,
  streamingMaxTokens,
  setStreamingMaxTokens,
  rephrasingMaxTokens,
  setRephrasingMaxTokens,
  crawlerAllSpaces,
  setCrawlerAllSpaces,
  crawlerSpaces,
  setCrawlerSpaces,
  crawlerPageSize,
  setCrawlerPageSize,
  crawlerMaxPages,
  setCrawlerMaxPages,
  crawlerConcurrency,
  setCrawlerConcurrency,
  availableSpaces,
  refreshSpaces,
  saveCrawlerConfig,
  triggerSync,
  saveRagConfig
}: SettingsDrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose} aria-label="Close settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="settings-content">
          {/* Query Settings */}
          <div className="settings-section">
            <h3>Query Settings</h3>
            <div className="setting-group">
              <label htmlFor="space-setting">
                <span>Space filter</span>
                <span className="setting-description">Limit search to specific Confluence space</span>
              </label>
              <input
                id="space-setting"
                type="text"
                placeholder="e.g., DOCS, TECH, PROD"
                value={space}
                onChange={(e) => setSpace(e.target.value)}
                className="text-input"
              />
            </div>

            <div className="setting-group">
              <label htmlFor="labels-setting">
                <span>Labels filter</span>
                <span className="setting-description">Comma-separated labels to filter by</span>
              </label>
              <input
                id="labels-setting"
                type="text"
                placeholder="e.g., api, guide, tutorial"
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                className="text-input"
              />
            </div>

            <div className="setting-group">
              <label htmlFor="topK-setting">
                <span>Documents to retrieve</span>
                <span className="setting-description">Number of relevant documents to find for each query</span>
              </label>
              <div className="range-input-group">
                <input
                  id="topK-setting"
                  type="range"
                  min="1"
                  max="20"
                  value={topK}
                  onChange={(e) => setTopK(Number(e.target.value))}
                  className="range-input"
                />
                <span className="range-value">{topK}</span>
              </div>
            </div>
          </div>

          {/* Model Settings */}
          <div className="settings-section">
            <h3>Model Settings</h3>
            <div className="setting-group">
              <label htmlFor="model-setting">
                <span>Language Model</span>
                <span className="setting-description">Choose the AI model for generating responses</span>
              </label>
              <select
                id="model-setting"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="select-input"
              >
                {availableModels.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="setting-group">
              <label htmlFor="temperature-setting">
                <span>Temperature</span>
                <span className="setting-description">Controls creativity vs consistency (0.0 = focused, 1.0 = creative)</span>
              </label>
              <div className="range-input-group">
                <input
                  id="temperature-setting"
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="range-input"
                />
                <span className="range-value">{temperature.toFixed(1)}</span>
              </div>
            </div>

            <div className="setting-group">
              <label htmlFor="max-tokens-setting">
                <span>Max Response Tokens</span>
                <span className="setting-description">Maximum tokens for standard responses (1000-16000)</span>
              </label>
              <div className="range-input-group">
                <input
                  id="max-tokens-setting"
                  type="range"
                  min="1000"
                  max="16000"
                  step="500"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  className="range-input"
                />
                <span className="range-value">{maxTokens}</span>
              </div>
            </div>

            <div className="setting-group">
              <label htmlFor="streaming-max-tokens-setting">
                <span>Max Streaming Tokens</span>
                <span className="setting-description">Maximum tokens for streaming responses (1000-16000)</span>
              </label>
              <div className="range-input-group">
                <input
                  id="streaming-max-tokens-setting"
                  type="range"
                  min="1000"
                  max="16000"
                  step="500"
                  value={streamingMaxTokens}
                  onChange={(e) => setStreamingMaxTokens(Number(e.target.value))}
                  className="range-input"
                />
                <span className="range-value">{streamingMaxTokens}</span>
              </div>
            </div>

            <div className="setting-group">
              <label htmlFor="rephrasing-max-tokens-setting">
                <span>Max Rephrasing Tokens</span>
                <span className="setting-description">Maximum tokens for response rephrasing (1000-8000)</span>
              </label>
              <div className="range-input-group">
                <input
                  id="rephrasing-max-tokens-setting"
                  type="range"
                  min="1000"
                  max="8000"
                  step="250"
                  value={rephrasingMaxTokens}
                  onChange={(e) => setRephrasingMaxTokens(Number(e.target.value))}
                  className="range-input"
                />
                <span className="range-value">{rephrasingMaxTokens}</span>
              </div>
            </div>
          </div>

          {/* RAG Pipeline Settings */}
          <div className="settings-section">
            <h3>RAG Pipeline Settings</h3>

            <div className="setting-group checkbox-group">
              <label htmlFor="optimized-pipeline">
                <span>Use Optimized Pipeline</span>
                <span className="setting-description">Enable advanced embeddings and chunking optimizations</span>
              </label>
              <input
                id="optimized-pipeline"
                type="checkbox"
                checked={ragConfig.useOptimizedPipeline}
                onChange={(e) => setRagConfig({...ragConfig, useOptimizedPipeline: e.target.checked})}
              />
            </div>

            <div className="setting-group checkbox-group">
              <label htmlFor="smart-fallback">
                <span>Enable Smart Fallback</span>
                <span className="setting-description">Use pure LLM analysis when vector search returns no results</span>
              </label>
              <input
                id="smart-fallback"
                type="checkbox"
                checked={ragConfig.useSmartPipeline}
                onChange={(e) => setRagConfig({...ragConfig, useSmartPipeline: e.target.checked})}
              />
            </div>

            <div className="setting-group">
              <label htmlFor="relevance-threshold">
                <span>Relevance Threshold</span>
                <span className="setting-description">Minimum similarity score to consider results relevant (0.01-1.0)</span>
              </label>
              <div className="range-input-group">
                <input
                  id="relevance-threshold"
                  type="range"
                  min="0.01"
                  max="1"
                  step="0.01"
                  value={ragConfig.relevanceThreshold}
                  onChange={(e) => setRagConfig({...ragConfig, relevanceThreshold: Number(e.target.value)})}
                  className="range-input"
                />
                <span className="range-value">{ragConfig.relevanceThreshold.toFixed(2)}</span>
              </div>
            </div>

            <div className="settings-action-buttons">
              <button className="settings-action-button" type="button" onClick={saveRagConfig} title="Save RAG settings" aria-label="Save RAG settings">
                Save RAG Settings
              </button>
            </div>
          </div>

          {/* Crawler Settings */}
          <div className="settings-section">
            <h3>Crawler Settings</h3>
            <div className="setting-group checkbox-group">
              <label htmlFor="crawler-allspaces">
                <span>Crawl all spaces</span>
                <span className="setting-description">Index all available Confluence spaces</span>
              </label>
              <input
                id="crawler-allspaces"
                type="checkbox"
                checked={crawlerAllSpaces}
                onChange={(e) => setCrawlerAllSpaces(e.target.checked)}
              />
            </div>
            <div className="setting-group">
              <label htmlFor="crawler-spaces">
                <span>Specific spaces to crawl</span>
                <span className="setting-description">Comma-separated list of space keys (only when not crawling all)</span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  id="crawler-spaces"
                  type="text"
                  placeholder="e.g., ENG,OPS,DOCS"
                  value={crawlerSpaces}
                  onChange={(e) => setCrawlerSpaces(e.target.value)}
                  className="text-input"
                  disabled={crawlerAllSpaces}
                />
                <button className="header-button" type="button" onClick={refreshSpaces} title="Fetch available spaces" aria-label="Fetch available spaces">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <polyline points="23 4 23 10 17 10"/>
                    <polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10M1 14l5.36 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                </button>
              </div>
              {availableSpaces.length > 0 && (
                <div className="setting-description">Available spaces: {availableSpaces.join(', ')}</div>
              )}
            </div>
            <div className="setting-group">
              <label htmlFor="crawler-pagesize">
                <span>Batch size</span>
                <span className="setting-description">Number of pages to fetch per API request (1-100)</span>
              </label>
              <input
                id="crawler-pagesize"
                type="number"
                min={1}
                max={100}
                value={crawlerPageSize}
                onChange={(e) => setCrawlerPageSize(Number(e.target.value))}
                className="text-input"
              />
            </div>
            <div className="setting-group">
              <label htmlFor="crawler-maxpages">
                <span>Max pages per sync</span>
                <span className="setting-description">Maximum number of pages to process in a single sync operation</span>
              </label>
              <input
                id="crawler-maxpages"
                type="number"
                min={1}
                value={crawlerMaxPages}
                onChange={(e) => setCrawlerMaxPages(Number(e.target.value))}
                className="text-input"
              />
            </div>
            <div className="setting-group">
              <label htmlFor="crawler-concurrency">
                <span>Processing threads</span>
                <span className="setting-description">Number of pages to process simultaneously (1-64)</span>
              </label>
              <input
                id="crawler-concurrency"
                type="number"
                min={1}
                max={64}
                value={crawlerConcurrency}
                onChange={(e) => setCrawlerConcurrency(Number(e.target.value))}
                className="text-input"
              />
            </div>
            <div className="settings-action-buttons">
              <button className="settings-action-button" type="button" onClick={saveCrawlerConfig} title="Save crawler config" aria-label="Save crawler config">
                Save
              </button>
              <button className="settings-action-button secondary" type="button" onClick={triggerSync} title="Sync now" aria-label="Sync now">
                Sync Now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}