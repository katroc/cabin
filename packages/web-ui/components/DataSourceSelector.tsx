'use client'

import { useState } from 'react'
import { Database, Upload, Globe, Github, FileText, X, ArrowLeft } from 'lucide-react'
import ConfluenceIndexing from './ConfluenceIndexing'
import FileUploadIndexing from './FileUploadIndexing'

interface DataSource {
  id: string
  name: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  component: React.ComponentType<{ isOpen: boolean; onClose: () => void }>
  available: boolean
}

interface DataSourceSelectorProps {
  isOpen: boolean
  onClose: () => void
}

export default function DataSourceSelector({ isOpen, onClose }: DataSourceSelectorProps) {
  const [selectedSource, setSelectedSource] = useState<string | null>(null)

  const dataSources: DataSource[] = [
    {
      id: 'confluence',
      name: 'Confluence',
      description: 'Import documentation from Confluence wiki spaces',
      icon: Globe,
      component: ConfluenceIndexing,
      available: true
    },
    {
      id: 'file_upload',
      name: 'File Upload',
      description: 'Upload and index local documents (PDF, DOCX, Markdown, etc.)',
      icon: Upload,
      component: FileUploadIndexing,
      available: true
    },
    {
      id: 'github',
      name: 'GitHub',
      description: 'Import documentation from GitHub repositories',
      icon: Github,
      component: () => null, // Placeholder
      available: false
    },
    {
      id: 'notion',
      name: 'Notion',
      description: 'Import pages and databases from Notion workspace',
      icon: FileText,
      component: () => null, // Placeholder
      available: false
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
  }

  const handleSourceClose = () => {
    setSelectedSource(null)
    onClose()
  }

  if (!isOpen) return null

  // If a specific source is selected, render its component
  if (selectedSource && selectedDataSource) {
    const SourceComponent = selectedDataSource.component
    return <SourceComponent isOpen={true} onClose={handleSourceClose} />
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <Database className="w-6 h-6 text-blue-500" />
            <h2 className="text-xl font-semibold">Add Data Source</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            Choose a data source to connect and index your content for search and Q&A.
          </p>

          {/* Data Source Grid */}
          <div className="grid gap-4 md:grid-cols-2">
            {dataSources.map((source) => {
              const IconComponent = source.icon
              return (
                <button
                  key={source.id}
                  onClick={() => handleSourceSelect(source.id)}
                  disabled={!source.available}
                  className={`
                    p-6 text-left border rounded-lg transition-all duration-200
                    ${source.available
                      ? 'border-gray-200 dark:border-gray-600 hover:border-blue-300 hover:shadow-md hover:scale-[1.02] cursor-pointer'
                      : 'border-gray-100 dark:border-gray-700 cursor-not-allowed opacity-50'
                    }
                  `}
                >
                  <div className="flex items-start space-x-4">
                    <div className={`
                      p-3 rounded-lg
                      ${source.available
                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                        : 'bg-gray-50 dark:bg-gray-700 text-gray-400'
                      }
                    `}>
                      <IconComponent className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        <h3 className="font-semibold text-gray-900 dark:text-white">
                          {source.name}
                        </h3>
                        {!source.available && (
                          <span className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded">
                            Coming Soon
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        {source.description}
                      </p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Help Text */}
          <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
              Need help choosing?
            </h4>
            <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
              <li>• <strong>Confluence:</strong> Best for team wikis and knowledge bases</li>
              <li>• <strong>File Upload:</strong> Perfect for local documents and one-time imports</li>
              <li>• <strong>GitHub:</strong> Ideal for technical documentation and README files</li>
              <li>• <strong>Notion:</strong> Great for structured notes and project documentation</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}