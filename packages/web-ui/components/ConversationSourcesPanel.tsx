'use client'

import { X, ExternalLink } from 'lucide-react'
import { useMemo } from 'react'

export interface AggregatedSource {
  key: string
  title: string
  url?: string
  usageCount: number
  lastUsed: Date
  firstUsed: Date
  quotes: string[]
}

interface ConversationSourcesPanelProps {
  open: boolean
  onClose: () => void
  sources: AggregatedSource[]
}

export default function ConversationSourcesPanel({ open, onClose, sources }: ConversationSourcesPanelProps) {
  const totalMentions = useMemo(
    () => sources.reduce((acc, source) => acc + source.usageCount, 0),
    [sources]
  )

  if (!open) {
    return null
  }

  return (
    <div className="sources-panel-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="sources-panel"
        role="complementary"
        aria-label="Conversation sources"
        onClick={event => event.stopPropagation()}
      >
        <header className="sources-panel__header">
          <div>
            <h2 className="sources-panel__title">Conversation Sources</h2>
            <p className="sources-panel__subtitle">
              {sources.length === 0
                ? 'No sources cited yet'
                : `${sources.length} source${sources.length === 1 ? '' : 's'} · ${totalMentions} mention${totalMentions === 1 ? '' : 's'}`}
            </p>
          </div>
          <button
            type="button"
            className="sources-panel__close"
            onClick={onClose}
            aria-label="Close sources panel"
          >
            <X size={16} />
          </button>
        </header>

        <div className="sources-panel__content" role="list">
          {sources.length === 0 ? (
            <div className="sources-panel__empty">
              <p>No sources have been cited in this conversation yet.</p>
              <p className="text-sm ui-text-muted">Ask a question that references your documentation to see sources appear here.</p>
            </div>
          ) : (
            sources.map(source => (
              <article key={source.key} className="sources-panel__item" role="listitem">
                <div className="sources-panel__item-header">
                  <div>
                    <div className="sources-panel__item-title">{source.title || 'Untitled source'}</div>
                    <div className="sources-panel__item-meta">
                      <span>{source.usageCount} mention{source.usageCount === 1 ? '' : 's'}</span>
                      <span>·</span>
                      <span>Last used {source.lastUsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      {source.firstUsed.getTime() !== source.lastUsed.getTime() && (
                        <>
                          <span>·</span>
                          <span>First seen {source.firstUsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {source.url && (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="sources-panel__item-link"
                    >
                      <ExternalLink size={14} />
                      <span>Open</span>
                    </a>
                  )}
                </div>

                {source.quotes.length > 0 && (
                  <div className="sources-panel__quotes">
                    {source.quotes.map((quote, index) => (
                      <blockquote key={index} className="sources-panel__quote">
                        “{quote}”
                      </blockquote>
                    ))}
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </aside>
    </div>
  )
}
