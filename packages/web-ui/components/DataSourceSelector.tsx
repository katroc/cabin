'use client'

import { useState } from 'react'
import { Database, Upload, Globe, Github, FileText, X, ArrowLeft, Settings2, Plus } from 'lucide-react'
import ConfluenceIndexing from './ConfluenceIndexing'
import FileUploadIndexing from './FileUploadIndexing'
import DataSourceManagement from './DataSourceManagement'

interface DataSource {
  id: string
  name: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  component: React.ComponentType<{ isOpen: boolean; onClose: () => void }>
  available: boolean
  category: 'files' | 'web' | 'cloud'
}

interface DataSourceSelectorProps {
  isOpen: boolean
  onClose: () => void
}

export default function DataSourceSelector({ isOpen, onClose }: DataSourceSelectorProps) {
  const [selectedSource, setSelectedSource] = useState<string | null>(null)
  const [currentView, setCurrentView] = useState<'selector' | 'management'>('selector')

  const dataSources: DataSource[] = [
    {
      id: 'file_upload',
      name: 'File Upload',
      description: 'Upload and index local documents (PDF, DOCX, Markdown, etc.)',
      icon: Upload,
      component: FileUploadIndexing,
      available: true,
      category: 'files'
    },
    {
      id: 'confluence',
      name: 'Confluence',
      description: 'Import documentation from Confluence wiki spaces',
      icon: Globe,
      component: ConfluenceIndexing,
      available: true,
      category: 'web'
    },
    {
      id: 'github',
      name: 'GitHub',
      description: 'Import documentation from GitHub repositories',
      icon: Github,
      component: () => null, // Placeholder
      available: false,
      category: 'cloud'
    },
    {
      id: 'notion',
      name: 'Notion',
      description: 'Import pages and databases from Notion workspace',
      icon: FileText,
      component: () => null, // Placeholder
      available: false,
      category: 'cloud'
    }
  ]

  const selectedDataSource = dataSources.find(ds => ds.id === selectedSource)

  const handleSourceSelect = (sourceId: string) => {
    const source = dataSources.find(ds => ds.id === sourceId)
    if (source?.available) {
      setSelectedSource(sourceId)
    }
  }

  const handleBack = () => {
    setSelectedSource(null)
    setCurrentView('selector')
  }

  const handleBackToSelector = () => {
    setSelectedSource(null)
    setCurrentView('selector')
  }

  const handleSourceClose = () => {
    setSelectedSource(null)
    setCurrentView('selector')
    onClose()
  }

  const handleManagementClose = () => {
    setCurrentView('selector')
  }

  if (!isOpen) return null

  // If data source management is selected
  if (currentView === 'management') {
    return <DataSourceManagement isOpen={true} onClose={handleManagementClose} onBack={handleBack} />
  }

  // If a specific source is selected, render its component
  if (selectedSource && selectedDataSource) {
    const SourceComponent = selectedDataSource.component
    return <SourceComponent isOpen={true} onClose={handleSourceClose} onBack={handleBackToSelector} />
  }

  // Group data sources by category
  const groupedSources = {
    files: dataSources.filter(ds => ds.category === 'files'),
    web: dataSources.filter(ds => ds.category === 'web'),
    cloud: dataSources.filter(ds => ds.category === 'cloud')
  }

  const categoryLabels = {
    files: { name: 'Local Files', description: 'Upload and index your own documents' },
    web: { name: 'Web Sources', description: 'Connect to online documentation' },
    cloud: { name: 'Cloud Platforms', description: 'Sync with cloud-based tools' }
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel fixed right-0 top-0 h-full w-full max-w-2xl overflow-hidden">
        {/* Header */}
        <div className="drawer-header" onClick={(e) => e.stopPropagation()}>
          <div className="drawer-title">
            <Database className="w-5 h-5 ui-text-secondary" />
            Data Sources
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentView('management')}
              className="btn-secondary btn-small"
              title="Manage existing data sources"
            >
              <Settings2 className="w-4 h-4" />
              Manage
            </button>
            <button onClick={onClose} className="btn-close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto h-full" onClick={(e) => e.stopPropagation()}>
          {/* Introduction */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold ui-text-primary mb-2">Add New Data Source</h3>
            <p className="ui-text-secondary text-sm">
              Connect and index your content to enable intelligent search and Q&A across your documentation.
            </p>
          </div>

          {/* Data Source Categories */}
          <div className="space-y-8">
            {Object.entries(groupedSources).map(([category, sources]) => {
              const categoryInfo = categoryLabels[category as keyof typeof categoryLabels]
              return (
                <div key={category} className="form-section">
                  <div className="mb-4">
                    <h4 className="form-section-title">{categoryInfo.name}</h4>
                    <p className="text-sm ui-text-muted">{categoryInfo.description}</p>
                  </div>

                  <div className="grid gap-3">
                    {sources.map((source) => {
                      const IconComponent = source.icon
                      return (
                        <button
                          key={source.id}
                          onClick={() => handleSourceSelect(source.id)}
                          disabled={!source.available}
                          className={`
                            group p-4 text-left border rounded-[var(--radius-md)] transition-all duration-200
                            ${source.available
                              ? 'ui-border-light hover:border-[var(--accent)] hover:ui-shadow-floating cursor-pointer'
                              : 'ui-border-faint cursor-not-allowed opacity-50'
                            }
                          `}
                        >
                          <div className="flex items-start gap-4">
                            <div className={`
                              p-3 rounded-[var(--radius-md)] transition-colors
                              ${source.available
                                ? 'ui-bg-tertiary group-hover:bg-[color-mix(in_oklab,var(--accent)_15%,transparent)]'
                                : 'ui-bg-tertiary'
                              }
                            `}>
                              <IconComponent className={`w-5 h-5 ${
                                source.available
                                  ? 'ui-text-secondary group-hover:text-[var(--accent)]'
                                  : 'ui-text-muted'
                              }`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h5 className="font-medium ui-text-primary text-sm">
                                  {source.name}
                                </h5>
                                {!source.available && (
                                  <span className="tag btn-small">
                                    Coming Soon
                                  </span>
                                )}
                              </div>
                              <p className="text-xs ui-text-muted line-clamp-2">
                                {source.description}
                              </p>
                            </div>
                            {source.available && (
                              <Plus className="w-4 h-4 ui-text-muted group-hover:text-[var(--accent)] transition-colors" />
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Help Section */}
          <div className="mt-8 p-4 ui-bg-tertiary border ui-border-faint rounded-[var(--radius-md)]">
            <h4 className="font-medium ui-text-primary mb-3 text-sm">
              Which data source should I choose?
            </h4>
            <div className="space-y-2 text-xs ui-text-muted">
              <div className="flex items-start gap-2">
                <Upload className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span><strong>File Upload:</strong> Best for one-time imports and local documents</span>
              </div>
              <div className="flex items-start gap-2">
                <Globe className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span><strong>Confluence:</strong> Ideal for team wikis and collaborative documentation</span>
              </div>
              <div className="flex items-start gap-2">
                <Github className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-50" />
                <span><strong>GitHub:</strong> Perfect for technical docs and README files</span>
              </div>
              <div className="flex items-start gap-2">
                <FileText className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-50" />
                <span><strong>Notion:</strong> Great for structured notes and project documentation</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}