'use client'

import { ReactNode } from 'react'
import { HelpCircle, AlertCircle, CheckCircle } from 'lucide-react'

interface SettingFieldProps {
  title: string
  description?: string
  children: ReactNode
  error?: string
  warning?: string
  success?: string
  helpText?: string
  required?: boolean
  className?: string
}

export function SettingField({
  title,
  description,
  children,
  error,
  warning,
  success,
  helpText,
  required = false,
  className = ''
}: SettingFieldProps) {
  return (
    <div className={`setting-field space-y-3 ${className}`}>
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-[color:var(--text-primary)]">
            {title}
            {required && <span className="text-[color:var(--error)] ml-1">*</span>}
          </h4>
          {helpText && (
            <button
              type="button"
              className="text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)] transition-colors"
              title={helpText}
            >
              <HelpCircle size={14} />
            </button>
          )}
        </div>

        {description && (
          <p className="text-xs text-[color:var(--text-muted)] leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {/* Control */}
      <div className="setting-control">
        {children}
      </div>

      {/* Status Messages */}
      <div className="space-y-1">
        {error && (
          <div className="flex items-center gap-2 text-[color:var(--error)]">
            <AlertCircle size={14} />
            <span className="text-xs">{error}</span>
          </div>
        )}

        {warning && !error && (
          <div className="flex items-center gap-2 text-[color:var(--warning)]">
            <AlertCircle size={14} />
            <span className="text-xs">{warning}</span>
          </div>
        )}

        {success && !error && !warning && (
          <div className="flex items-center gap-2 text-[color:var(--success)]">
            <CheckCircle size={14} />
            <span className="text-xs">{success}</span>
          </div>
        )}
      </div>
    </div>
  )
}

interface SettingGroupProps {
  title: string
  description?: string
  children: ReactNode
  collapsible?: boolean
  defaultCollapsed?: boolean
  className?: string
}

export function SettingGroup({
  title,
  description,
  children,
  collapsible = false,
  defaultCollapsed = false,
  className = ''
}: SettingGroupProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)

  return (
    <div className={`setting-group space-y-4 ${className}`}>
      {/* Group Header */}
      <div className="border-b border-[color:var(--border-faint)] pb-3">
        <div
          className={`flex items-center justify-between ${collapsible ? 'cursor-pointer' : ''}`}
          onClick={collapsible ? () => setIsCollapsed(!isCollapsed) : undefined}
        >
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-[color:var(--accent)]">
              {title}
            </h3>
            {description && (
              <p className="text-sm text-[color:var(--text-secondary)]">
                {description}
              </p>
            )}
          </div>

          {collapsible && (
            <button
              type="button"
              className="text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)] transition-colors"
            >
              <svg
                className={`w-4 h-4 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Group Content */}
      {(!collapsible || !isCollapsed) && (
        <div className="space-y-6">
          {children}
        </div>
      )}
    </div>
  )
}

// Import useState for the SettingGroup component
import { useState } from 'react'