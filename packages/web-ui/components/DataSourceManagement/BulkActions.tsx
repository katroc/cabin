'use client'

import { useState } from 'react'
import { Trash2, Download, Archive, Tag, MoreHorizontal, CheckCircle, LucideIcon } from 'lucide-react'
import { BulkAction } from './types'

interface BulkActionsProps {
  selectedIds: string[]
  actions: BulkAction[]
  onActionComplete?: () => void
  hasSelection: boolean
  compact?: boolean
}

export default function BulkActions({ selectedIds, actions, onActionComplete, hasSelection, compact = false }: BulkActionsProps) {
  const [executingAction, setExecutingAction] = useState<string | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)

  const handleAction = async (action: BulkAction) => {
    if (executingAction) return

    setExecutingAction(action.id)
    setShowDropdown(false)

    try {
       await action.action(selectedIds)
      onActionComplete?.()
    } catch (error) {
       console.error(`Failed to execute action ${action.id}:`, error)
       // TODO: Show error toast with user-friendly message
       alert(`Failed to ${action.label.toLowerCase()} documents: ${error instanceof Error ? error.message : 'Unknown error'}`)
     } finally {
      setExecutingAction(null)
    }
  }

  const primaryActions = actions.filter(action => action.id === 'delete')
  const secondaryActions = actions.filter(action => !primaryActions.includes(action))

  if (compact) {
    // Compact mode for header
    return (
      <div className="flex items-center gap-2">
        {hasSelection && (
          <>
            <div className="flex items-center gap-1 text-sm ui-text-muted">
              <CheckCircle className="w-3 h-3 text-[var(--success)]" />
              <span>{selectedIds.length} selected</span>
            </div>

            {/* Primary Actions */}
            {primaryActions.map((action) => (
              <button
                key={action.id}
                onClick={() => handleAction(action)}
                disabled={executingAction !== null || selectedIds.length === 0}
                className={`
                  inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)]
                  transition-all duration-200 text-xs
                  ${action.id === 'delete'
                    ? 'ui-bg-tertiary border border-[var(--error)] text-[var(--error)] hover:bg-[var(--error)] hover:text-white'
                    : 'btn-primary'
                  }
                  ${executingAction === action.id || selectedIds.length === 0
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:opacity-90'
                  }
                `}
              >
                {executingAction === action.id ? (
                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <action.icon className="w-3 h-3" />
                )}
                {action.label}
              </button>
            ))}

            {/* Secondary Actions Dropdown */}
            {secondaryActions.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  disabled={executingAction !== null || selectedIds.length === 0}
                  className={`inline-flex items-center gap-1 px-2 py-1 btn-secondary rounded-[var(--radius-sm)] text-xs ${
                    executingAction !== null || selectedIds.length === 0
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:ui-bg-tertiary'
                  }`}
                >
                  <MoreHorizontal className="w-3 h-3" />
                  More
                </button>

                {showDropdown && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowDropdown(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 w-48 ui-bg-secondary border ui-border-faint rounded-[var(--radius-md)] shadow-lg z-20">
                      {secondaryActions.map((action) => (
                        <button
                          key={action.id}
                          onClick={() => handleAction(action)}
                          disabled={executingAction !== null || selectedIds.length === 0}
                          className={`
                            w-full flex items-center gap-3 px-4 py-3 text-left text-sm
                            hover:ui-bg-tertiary transition-colors
                            ${executingAction === action.id || selectedIds.length === 0 ? 'opacity-50' : ''}
                            ${action.id === secondaryActions[secondaryActions.length - 1].id ? '' : 'border-b ui-border-faint'}
                          `}
                        >
                          {executingAction === action.id ? (
                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <action.icon className="w-4 h-4 ui-text-muted" />
                          )}
                          <span className="ui-text-primary">{action.label}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  // Full mode for main content area
  return (
    <div className={`transition-all duration-300 ease-in-out ${
      hasSelection
        ? 'p-4 ui-bg-tertiary border ui-border-faint rounded-[var(--radius-md)]'
        : 'p-2 ui-bg-secondary border ui-border-faint rounded-[var(--radius-sm)] opacity-60'
    }`}>
      {hasSelection ? (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-[var(--success)]" />
              <span className="font-medium ui-text-primary">
                {selectedIds.length} document{selectedIds.length > 1 ? 's' : ''} selected
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Primary Actions */}
              {primaryActions.map((action) => (
                <button
                  key={action.id}
                  onClick={() => handleAction(action)}
                  disabled={executingAction !== null || selectedIds.length === 0}
                  className={`
                    inline-flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)]
                    transition-all duration-200 text-sm
                    ${action.id === 'delete'
                      ? 'ui-bg-tertiary border border-[var(--error)] text-[var(--error)] hover:bg-[var(--error)] hover:text-white'
                      : 'btn-primary'
                    }
                    ${executingAction === action.id || selectedIds.length === 0
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:opacity-90'
                    }
                  `}
                >
                  {executingAction === action.id ? (
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <action.icon className="w-4 h-4" />
                  )}
                  {action.label}
                </button>
              ))}

              {/* Secondary Actions Dropdown */}
              {secondaryActions.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setShowDropdown(!showDropdown)}
                    disabled={executingAction !== null || selectedIds.length === 0}
                    className={`inline-flex items-center gap-2 px-3 py-2 btn-secondary rounded-[var(--radius-sm)] text-sm ${
                      executingAction !== null || selectedIds.length === 0
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:ui-bg-tertiary'
                    }`}
                  >
                    <MoreHorizontal className="w-4 h-4" />
                    More
                  </button>

                  {showDropdown && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowDropdown(false)}
                      />
                      <div className="absolute right-0 top-full mt-1 w-48 ui-bg-secondary border ui-border-faint rounded-[var(--radius-md)] shadow-lg z-20">
                        {secondaryActions.map((action) => (
                          <button
                            key={action.id}
                            onClick={() => handleAction(action)}
                            disabled={executingAction !== null || selectedIds.length === 0}
                            className={`
                              w-full flex items-center gap-3 px-4 py-3 text-left text-sm
                              hover:ui-bg-tertiary transition-colors
                              ${executingAction === action.id || selectedIds.length === 0 ? 'opacity-50' : ''}
                              ${action.id === secondaryActions[secondaryActions.length - 1].id ? '' : 'border-b ui-border-faint'}
                            `}
                          >
                            {executingAction === action.id ? (
                              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <action.icon className="w-4 h-4 ui-text-muted" />
                            )}
                            <span className="ui-text-primary">{action.label}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center">
          <span className="text-sm ui-text-muted">Select documents to perform bulk actions</span>
        </div>
      )}
    </div>
  )
}

// Default bulk actions
export const defaultBulkActions: BulkAction[] = [
  {
    id: 'delete',
    label: 'Delete',
    icon: Trash2,
    action: async (selectedIds: string[]) => {
      try {
        const response = await fetch('http://localhost:8788/api/data-sources/documents', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ document_ids: selectedIds })
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.detail || `Failed to delete documents: ${response.status}`)
        }

        const result = await response.json()
         console.log('Delete result:', result)

         if (result.deleted_count === 0) {
           throw new Error('No documents were deleted. This may be because the documents no longer exist or have already been deleted.')
         }

         // Show success message
         alert(`Successfully deleted ${result.deleted_count} document${result.deleted_count > 1 ? 's' : ''}`)

         return result
      } catch (error) {
        console.error('Failed to delete documents:', error)
        throw error
      }
    },
    requiresConfirmation: true,
    confirmationMessage: 'Are you sure you want to delete the selected documents? This action cannot be undone.'
  }
]