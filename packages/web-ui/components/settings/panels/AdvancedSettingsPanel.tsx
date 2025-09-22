'use client'

import { SettingField, SettingGroup } from '../SettingField'
import { SettingControl } from '../SettingControl'
import { useSettings } from '../SettingsProvider'

export function AdvancedSettingsPanel() {
  const { state, updateSetting } = useSettings()

  return (
    <div className="space-y-8">
      <SettingGroup
        title="Document Deduplication"
        description="Remove duplicate or near-duplicate passages from search results"
      >
        <SettingField
          title="Deduplication Status"
          description="Enable automatic removal of duplicate content"
        >
          <SettingControl
            type="toggle"
            id="dedupEnabled"
            label="Enable Deduplication"
            value={state.data.dedupEnabled}
            onChange={(value) => updateSetting('dedupEnabled', value)}
            description="Automatically filter out duplicate or very similar passages"
            error={state.validationErrors.dedupEnabled}
          />
        </SettingField>

        <SettingField
          title="Deduplication Method"
          description="Algorithm used for detecting duplicate content"
        >
          <SettingControl
            type="select"
            id="dedupMethod"
            label="Deduplication Method"
            value={state.data.dedupMethod}
            onChange={(value) => updateSetting('dedupMethod', value)}
            options={[
              { value: 'minhash', label: 'MinHash' },
              { value: 'jaccard', label: 'Jaccard Similarity' },
              { value: 'cosine', label: 'Cosine Similarity' },
              { value: 'fuzzy', label: 'Fuzzy String Matching' }
            ]}
            description="Different methods have varying speed and accuracy trade-offs"
            error={state.validationErrors.dedupMethod}
          />
        </SettingField>

        <SettingField
          title="Similarity Threshold"
          description="How similar passages must be to be considered duplicates"
        >
          <SettingControl
            type="slider"
            id="dedupThreshold"
            label="Deduplication Threshold"
            value={state.data.dedupThreshold}
            onChange={(value) => updateSetting('dedupThreshold', value)}
            min={0.5}
            max={1.0}
            step={0.01}
            formatValue={(value) => `${(value * 100).toFixed(0)}%`}
            description="Higher values require more similarity to consider passages duplicates"
            error={state.validationErrors.dedupThreshold}
          />
        </SettingField>
      </SettingGroup>

      <SettingGroup
        title="RM3 Query Expansion"
        description="Relevance Model 3 parameters for improving query understanding"
      >
        <SettingField
          title="Top Documents"
          description="Number of top documents to use for query expansion"
        >
          <SettingControl
            type="slider"
            id="rm3TopDocs"
            label="RM3 Top Documents"
            value={state.data.rm3TopDocs}
            onChange={(value) => updateSetting('rm3TopDocs', value)}
            min={1}
            max={50}
            step={1}
            formatValue={(value) => `${value} documents`}
            description="More documents provide richer expansion but may introduce noise"
            error={state.validationErrors.rm3TopDocs}
          />
        </SettingField>

        <SettingField
          title="Expansion Terms"
          description="Number of terms to add to the original query"
        >
          <SettingControl
            type="slider"
            id="rm3Terms"
            label="RM3 Terms"
            value={state.data.rm3Terms}
            onChange={(value) => updateSetting('rm3Terms', value)}
            min={1}
            max={50}
            step={1}
            formatValue={(value) => `${value} terms`}
            description="Additional terms from relevant documents to expand the query"
            error={state.validationErrors.rm3Terms}
          />
        </SettingField>

        <SettingField
          title="Alpha Parameter"
          description="Weight of original query vs expanded terms"
        >
          <SettingControl
            type="slider"
            id="rm3Alpha"
            label="RM3 Alpha"
            value={state.data.rm3Alpha}
            onChange={(value) => updateSetting('rm3Alpha', value)}
            min={0}
            max={1}
            step={0.1}
            formatValue={(value) => value.toFixed(1)}
            description="Higher values favor original query terms over expansion terms"
            error={state.validationErrors.rm3Alpha}
          />
        </SettingField>
      </SettingGroup>

      <SettingGroup
        title="Content Verification"
        description="Settings for validating and verifying retrieved content"
      >
        <SettingField
          title="Fuzzy Matching Threshold"
          description="Minimum similarity score for fuzzy string matching"
        >
          <SettingControl
            type="slider"
            id="fuzzyPartialRatioMin"
            label="Fuzzy Partial Ratio Minimum"
            value={state.data.fuzzyPartialRatioMin}
            onChange={(value) => updateSetting('fuzzyPartialRatioMin', value)}
            min={0}
            max={100}
            step={5}
            formatValue={(value) => `${value}%`}
            description="Used for verifying quote accuracy and content matching"
            error={state.validationErrors.fuzzyPartialRatioMin}
          />
        </SettingField>
      </SettingGroup>

      <SettingGroup
        title="Expert Configuration"
        description="Advanced settings for experienced users"
      >
        <SettingField
          title="Configuration Warning"
          description="Important notice about advanced settings"
        >
          <div className="p-4 bg-[color:var(--warning)]/10 border border-[color:var(--warning)]/20 rounded-lg">
            <div className="space-y-2 text-sm">
              <p className="font-medium text-[color:var(--text-primary)] flex items-center gap-2">
                ⚠️ Expert Settings
              </p>
              <p className="text-xs text-[color:var(--text-secondary)]">
                These advanced settings can significantly impact system performance and accuracy.
                Only modify these values if you understand their implications and have specific
                requirements that warrant changes from the defaults.
              </p>
              <ul className="space-y-1 text-xs text-[color:var(--text-muted)] ml-4">
                <li>• Incorrect deduplication settings may remove relevant content</li>
                <li>• RM3 parameters affect query expansion and retrieval quality</li>
                <li>• Fuzzy matching thresholds impact content verification accuracy</li>
                <li>• Changes may require reindexing or system restart</li>
              </ul>
            </div>
          </div>
        </SettingField>

        <SettingField
          title="Reset to Defaults"
          description="Restore all advanced settings to their recommended values"
        >
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => {
                // Reset advanced settings to defaults
                updateSetting('dedupEnabled', true)
                updateSetting('dedupMethod', 'minhash')
                updateSetting('dedupThreshold', 0.92)
                updateSetting('rm3TopDocs', 10)
                updateSetting('rm3Terms', 10)
                updateSetting('rm3Alpha', 0.4)
                updateSetting('fuzzyPartialRatioMin', 70)
              }}
              className="btn-secondary"
            >
              Reset Advanced Settings to Defaults
            </button>
            <p className="text-xs text-[color:var(--text-muted)]">
              This will reset all advanced settings on this page to their recommended default values.
              Other settings categories will not be affected.
            </p>
          </div>
        </SettingField>
      </SettingGroup>
    </div>
  )
}