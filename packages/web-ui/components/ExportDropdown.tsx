'use client'

import { useState, useRef, useEffect } from 'react'
import { Download, FileJson, ChevronDown } from 'lucide-react'

interface ExportDropdownProps {
  onDownloadConversation: (format: 'json' | 'markdown') => void
  disabled?: boolean
}

export default function ExportDropdown({ onDownloadConversation, disabled = false }: ExportDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleExport = (format: 'json' | 'markdown') => {
    onDownloadConversation(format)
    setIsOpen(false)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ui-bg-secondary ui-border-light ui-text-secondary hover:text-white hover:border-[var(--accent)]"
      >
        <Download size={16} />
        Export
        <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border ui-bg-secondary ui-border-light ui-shadow-floating">
          <div className="py-1">
            <button
              onClick={() => handleExport('markdown')}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left transition hover:ui-bg-primary ui-text-primary"
            >
              <Download size={14} />
              Markdown
            </button>
            <button
              onClick={() => handleExport('json')}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left transition hover:ui-bg-primary ui-text-primary"
            >
              <FileJson size={14} />
              JSON
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
