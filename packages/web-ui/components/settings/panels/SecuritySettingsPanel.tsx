'use client'

import { useState } from 'react'
import { SettingField, SettingGroup } from '../SettingField'
import { SettingControl } from '../SettingControl'
import { useSettings } from '../SettingsProvider'
import { X, Plus } from 'lucide-react'

export function SecuritySettingsPanel() {
  const { state, updateSetting } = useSettings()
  const [newLabel, setNewLabel] = useState('')

  const handleAddLabel = () => {
    if (newLabel.trim() && !state.data.dropLabels.includes(newLabel.trim())) {
      const updatedLabels = [...state.data.dropLabels, newLabel.trim()]
      updateSetting('dropLabels', updatedLabels)
      setNewLabel('')
    }
  }

  const handleRemoveLabel = (labelToRemove: string) => {
    const updatedLabels = state.data.dropLabels.filter(label => label !== labelToRemove)
    updateSetting('dropLabels', updatedLabels)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddLabel()
    }
  }

  return (
    <div className="space-y-8">
      <SettingGroup
        title="Content Privacy"
        description="Control what content is filtered or removed during processing"
      >
        <SettingField
          title="Boilerplate Removal"
          description="Automatically remove common boilerplate content from documents"
        >
          <SettingControl
            type="toggle"
            id="dropBoilerplate"
            label="Remove Boilerplate Content"
            value={state.data.dropBoilerplate}
            onChange={(value) => updateSetting('dropBoilerplate', value)}
            description="Filter out headers, footers, navigation, and other template content"
            error={state.validationErrors.dropBoilerplate}
          />
        </SettingField>

        <SettingField
          title="Content Label Filtering"
          description="Exclude documents or sections with specific labels"
        >
          <div className="space-y-3">
            {/* Current Labels */}
            {state.data.dropLabels.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-[color:var(--text-secondary)] font-medium">
                  Current Filter Labels:
                </p>
                <div className="flex flex-wrap gap-2">
                  {state.data.dropLabels.map((label, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-[color:var(--bg-tertiary)] text-[color:var(--text-primary)] text-xs rounded-md border border-[color:var(--border-faint)]"
                    >
                      {label}
                      <button
                        type="button"
                        onClick={() => handleRemoveLabel(label)}
                        className="text-[color:var(--text-muted)] hover:text-[color:var(--error)] transition-colors"
                        title={`Remove ${label}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Add New Label */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Enter label to filter (e.g., template, archive)"
                className="flex-1 input-base text-sm"
              />
              <button
                type="button"
                onClick={handleAddLabel}
                disabled={!newLabel.trim() || state.data.dropLabels.includes(newLabel.trim())}
                className="btn-secondary px-3 py-2 text-sm flex items-center gap-1"
                title="Add label"
              >
                <Plus size={14} />
                Add
              </button>
            </div>

            <p className="text-xs text-[color:var(--text-muted)]">
              Documents or sections tagged with these labels will be excluded from search results.
              Common examples: template, archive, index, navigation, sidebar.
            </p>

            {state.validationErrors.dropLabels && (
              <p className="text-xs text-[color:var(--error)]">
                {state.validationErrors.dropLabels}
              </p>
            )}
          </div>
        </SettingField>
      </SettingGroup>

      <SettingGroup
        title="Data Protection"
        description="Additional privacy and security measures"
      >
        <SettingField
          title="Information Notice"
          description="Important information about data handling"
        >
          <div className="p-4 bg-[color:var(--bg-tertiary)] border border-[color:var(--border-faint)] rounded-lg">
            <div className="space-y-3 text-sm text-[color:var(--text-secondary)]">
              <p className="font-medium text-[color:var(--text-primary)]">
                🔒 Privacy & Security
              </p>
              <ul className="space-y-2 text-xs">
                <li>• All document processing happens locally on your infrastructure</li>
                <li>• No data is sent to external services unless explicitly configured</li>
                <li>• Embedding and LLM providers you configure may receive query data</li>
                <li>• Review your AI provider privacy policies for external services</li>
                <li>• Consider using local/self-hosted models for maximum privacy</li>
              </ul>
            </div>
          </div>
        </SettingField>

        <SettingField
          title="Local Processing Recommendation"
          description="For maximum security, use local AI models"
        >
          <div className="p-4 bg-[color:var(--accent)]/10 border border-[color:var(--accent)]/20 rounded-lg">
            <div className="space-y-2 text-sm">
              <p className="font-medium text-[color:var(--text-primary)]">
                💡 Recommended for Sensitive Data
              </p>
              <p className="text-xs text-[color:var(--text-secondary)]">
                For processing confidential or sensitive documents, consider using:
              </p>
              <ul className="space-y-1 text-xs text-[color:var(--text-secondary)] ml-4">
                <li>• Local LLM servers (Ollama, LM Studio, etc.)</li>
                <li>• Self-hosted embedding models</li>
                <li>• Local reranker instances</li>
                <li>• Air-gapped environments when possible</li>
              </ul>
            </div>
          </div>
        </SettingField>
      </SettingGroup>
    </div>
  )
}