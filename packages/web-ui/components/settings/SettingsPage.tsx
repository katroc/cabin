'use client'

import {
  Settings,
  Bot,
  Search,
  Zap,
  Shield,
  Wrench
} from 'lucide-react'

import { SettingsLayout, SettingsTab } from './SettingsLayout'
import { SettingsProvider, useSettings } from './SettingsProvider'
import { GeneralSettingsPanel } from './panels/GeneralSettingsPanel'
import { AIModelsSettingsPanel } from './panels/AIModelsSettingsPanel'
import { RetrievalSettingsPanel } from './panels/RetrievalSettingsPanel'
import { PerformanceSettingsPanel } from './panels/PerformanceSettingsPanel'
import { SecuritySettingsPanel } from './panels/SecuritySettingsPanel'
import { AdvancedSettingsPanel } from './panels/AdvancedSettingsPanel'

function SettingsContent() {
  const { state, saveSetting, resetSettings } = useSettings()

  const settingsTabs: SettingsTab[] = [
    {
      id: 'general',
      label: 'General',
      icon: <Settings size={18} />,
      component: <GeneralSettingsPanel />
    },
    {
      id: 'ai-models',
      label: 'AI Models',
      icon: <Bot size={18} />,
      component: <AIModelsSettingsPanel />
    },
    {
      id: 'retrieval',
      label: 'Retrieval',
      icon: <Search size={18} />,
      component: <RetrievalSettingsPanel />
    },
    {
      id: 'performance',
      label: 'Performance',
      icon: <Zap size={18} />,
      component: <PerformanceSettingsPanel />
    },
    {
      id: 'security',
      label: 'Security',
      icon: <Shield size={18} />,
      component: <SecuritySettingsPanel />
    },
    {
      id: 'advanced',
      label: 'Advanced',
      icon: <Wrench size={18} />,
      component: <AdvancedSettingsPanel />
    }
  ]

  return (
    <SettingsLayout
      tabs={settingsTabs}
      defaultTab="general"
      onSave={saveSetting}
      onReset={resetSettings}
      hasUnsavedChanges={state.hasUnsavedChanges}
      isSaving={state.isSaving}
      lastSaved={state.lastSaved}
      saveError={state.saveError}
    />
  )
}

interface SettingsPageProps {
  settingsEndpoint?: string
}

export function SettingsPage({ settingsEndpoint }: SettingsPageProps) {
  return (
    <div className="h-full bg-[color:var(--bg-primary)]">
      <SettingsProvider settingsEndpoint={settingsEndpoint}>
        <SettingsContent />
      </SettingsProvider>
    </div>
  )
}