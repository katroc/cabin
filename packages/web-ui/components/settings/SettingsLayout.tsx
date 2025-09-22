'use client'

import { useState, ReactNode } from 'react'
import {
  Settings,
  Bot,
  Search,
  Zap,
  Shield,
  Wrench,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle
} from 'lucide-react'

export interface SettingsTab {
  id: string
  label: string
  icon: ReactNode
  component: ReactNode
}

interface SettingsLayoutProps {
  tabs: SettingsTab[]
  defaultTab?: string
  onSave?: () => Promise<void>
  onReset?: () => void
  hasUnsavedChanges?: boolean
  isSaving?: boolean
  lastSaved?: Date
  saveError?: string
}

export function SettingsLayout({
  tabs,
  defaultTab,
  onSave,
  onReset,
  hasUnsavedChanges = false,
  isSaving = false,
  lastSaved,
  saveError
}: SettingsLayoutProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id)

  const activeTabData = tabs.find(tab => tab.id === activeTab) || tabs[0]

  const handleSave = async () => {
    if (onSave && !isSaving) {
      await onSave()
    }
  }

  const handleReset = () => {
    if (onReset && !isSaving) {
      onReset()
    }
  }

  return (
    <div className="settings-layout h-full flex">
      {/* Sidebar Navigation */}
      <div className="settings-sidebar w-64 bg-[color:var(--bg-tertiary)] border-r border-[color:var(--border-faint)] flex flex-col">
        {/* Sidebar Header */}
        <div className="p-4 border-b border-[color:var(--border-faint)]">
          <h2 className="text-lg font-semibold text-[color:var(--text-primary)] flex items-center gap-2">
            <Settings size={20} />
            Settings
          </h2>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex-1 p-2">
          <ul className="space-y-1">
            {tabs.map((tab) => (
              <li key={tab.id}>
                <button
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200
                    flex items-center gap-3
                    ${activeTab === tab.id
                      ? 'bg-[color:var(--accent)] text-white shadow-md'
                      : 'text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)]'
                    }
                  `}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Sidebar Footer - Save Status */}
        <div className="p-4 border-t border-[color:var(--border-faint)] space-y-3">
          {/* Save Status */}
          <div className="text-xs text-[color:var(--text-muted)]">
            {isSaving && (
              <div className="flex items-center gap-2">
                <RefreshCw size={12} className="animate-spin" />
                Saving...
              </div>
            )}

            {!isSaving && hasUnsavedChanges && (
              <div className="flex items-center gap-2 text-[color:var(--warning)]">
                <AlertCircle size={12} />
                Unsaved changes
              </div>
            )}

            {!isSaving && !hasUnsavedChanges && lastSaved && (
              <div className="flex items-center gap-2 text-[color:var(--success)]">
                <CheckCircle size={12} />
                Saved {lastSaved.toLocaleTimeString()}
              </div>
            )}

            {saveError && (
              <div className="flex items-center gap-2 text-[color:var(--error)]">
                <AlertCircle size={12} />
                {saveError}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={!hasUnsavedChanges || isSaving}
              className="btn-primary btn-small flex-1 text-xs"
            >
              {isSaving ? (
                <>
                  <RefreshCw size={12} className="animate-spin" />
                  Saving
                </>
              ) : (
                <>
                  <Save size={12} />
                  Save
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleReset}
              disabled={!hasUnsavedChanges || isSaving}
              className="btn-secondary btn-small px-2"
              title="Reset to defaults"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="settings-content flex-1 flex flex-col min-h-0">
        {/* Content Header */}
        <div className="settings-content-header p-6 border-b border-[color:var(--border-faint)] bg-[color:var(--bg-secondary)]">
          <div className="flex items-center gap-3">
            {activeTabData.icon}
            <div>
              <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">
                {activeTabData.label}
              </h1>
              <p className="text-sm text-[color:var(--text-secondary)] mt-1">
                Configure {activeTabData.label.toLowerCase()} settings for your application
              </p>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="settings-content-body flex-1 overflow-y-auto p-6 bg-[color:var(--bg-primary)]">
          <div className="max-w-2xl">
            {activeTabData.component}
          </div>
        </div>
      </div>
    </div>
  )
}

// Predefined tab configurations for easy setup
export const defaultSettingsTabs: SettingsTab[] = [
  {
    id: 'general',
    label: 'General',
    icon: <Settings size={18} />,
    component: <div>General settings panel</div>
  },
  {
    id: 'ai-models',
    label: 'AI Models',
    icon: <Bot size={18} />,
    component: <div>AI Models settings panel</div>
  },
  {
    id: 'retrieval',
    label: 'Retrieval',
    icon: <Search size={18} />,
    component: <div>Retrieval settings panel</div>
  },
  {
    id: 'performance',
    label: 'Performance',
    icon: <Zap size={18} />,
    component: <div>Performance settings panel</div>
  },
  {
    id: 'security',
    label: 'Security',
    icon: <Shield size={18} />,
    component: <div>Security settings panel</div>
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: <Wrench size={18} />,
    component: <div>Advanced settings panel</div>
  }
]