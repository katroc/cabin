'use client'

import { ReactNode, useEffect, useMemo, useState } from 'react'
import { MessageSquare, Pin, Trash2, Search } from 'lucide-react'

interface ConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface Conversation {
  id: string
  title: string
  lastMessage: string
  timestamp: Date
  isPinned: boolean
  messageCount: number
  messages: ConversationMessage[]
}

interface ConversationHistoryProps {
  conversations: Conversation[]
  activeConversationId: string | null
  onSelectConversation: (id: string) => void
  onPinConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
  onNewConversation: () => void
  onDeleteAllConversations: () => void
  className?: string
  headerActions?: React.ReactNode
}

export default function ConversationHistory({
  conversations,
  activeConversationId,
  onSelectConversation,
  onPinConversation,
  onDeleteConversation,
  onNewConversation,
  onDeleteAllConversations,
  className,
  headerActions
}: ConversationHistoryProps) {
  const [searchTerm, setSearchTerm] = useState('')

  const filteredConversations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) {
      return conversations
    }
    return conversations.filter(conv =>
      conv.title.toLowerCase().includes(term) || conv.lastMessage.toLowerCase().includes(term)
    )
  }, [conversations, searchTerm])

  const pinnedConversations = filteredConversations.filter(conv => conv.isPinned)
  const unpinnedConversations = filteredConversations.filter(conv => !conv.isPinned)
  useEffect(() => {
    if (!activeConversationId) return
    const element = document.getElementById(`conversation-${activeConversationId}`)
    element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [activeConversationId, filteredConversations.length])

  return (
    <aside
      className={`flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r ui-border-faint ui-bg-secondary ${className ?? 'w-80'}`}
      role="complementary"
      aria-label="Conversation history"
    >
      <div className="space-y-3 border-b px-4 py-4 border-[color:var(--border-faint)]">
        <div className="flex items-center justify-between gap-2.5">
          <h2 className="text-sm font-semibold ui-text-primary">
            Conversations
          </h2>
          <div className="flex items-center gap-2">
            {headerActions}
            {conversations.length > 0 && (
              <button
                type="button"
                onClick={onDeleteAllConversations}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-w-[60px] ui-bg-primary ui-border-light ${conversations.length === 0 ? 'ui-text-muted' : 'ui-text-secondary'}`}
                disabled={conversations.length === 0}
              >
                Clear
              </button>
            )}
            <button
              onClick={onNewConversation}
              className="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors min-w-[60px] bg-[var(--accent)] text-white border-[var(--accent)]"
            >
              New
            </button>
          </div>
        </div>
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 ui-text-muted"
          />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-transparent rounded-full pr-8 py-2 border ui-border-light ui-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition text-sm"
            style={{ paddingLeft: '40px' }}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs ui-text-muted"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3 min-h-0">
        {pinnedConversations.length > 0 && (
          <section className="space-y-2">
            <div className="text-xs ui-text-muted">
              <span>Pinned</span>
            </div>
            <div className="space-y-1.5">
              {pinnedConversations.map(conversation => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  isActive={conversation.id === activeConversationId}
                  onSelect={() => onSelectConversation(conversation.id)}
                  onPin={() => onPinConversation(conversation.id)}
                  onDelete={() => onDeleteConversation(conversation.id)}
                />
              ))}
            </div>
          </section>
        )}

        <section className="space-y-1.5">
          <div className="text-xs ui-text-muted">
            <span>{pinnedConversations.length > 0 ? 'Recent' : 'All Conversations'}</span>
          </div>
          <div className="space-y-1.5">
            {unpinnedConversations.map(conversation => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                isActive={conversation.id === activeConversationId}
                onSelect={() => onSelectConversation(conversation.id)}
                onPin={() => onPinConversation(conversation.id)}
                onDelete={() => onDeleteConversation(conversation.id)}
              />
            ))}
          </div>

          {filteredConversations.length === 0 && (
            <div className="text-center py-8">
              <MessageSquare
                size={36}
                className="mx-auto mb-3 opacity-60 text-[var(--text-muted)]"
              />
              <p className="text-sm ui-text-muted">
                No conversations found
              </p>
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}

interface ConversationItemProps {
  conversation: Conversation
  isActive: boolean
  onSelect: () => void
  onPin: () => void
  onDelete: () => void
}

function ConversationItem({ conversation, isActive, onSelect, onPin, onDelete }: ConversationItemProps) {
  const messagePreview = conversation.lastMessage
    || (conversation.messageCount > 0
      ? `${conversation.messageCount} message${conversation.messageCount === 1 ? '' : 's'} in this thread.`
      : 'No messages yet — start the conversation!')

  const itemClasses = isActive
    ? 'ui-bg-tertiary border-[var(--accent)]'
    : 'ui-bg-secondary ui-border-faint hover:bg-[var(--bg-hover)] hover:border-[var(--border-light)]'

  return (
    <div
      id={`conversation-${conversation.id}`}
      className={`group relative cursor-pointer rounded-xl border p-2.5 transition-colors ${itemClasses}`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold truncate ui-text-primary">
              {conversation.title}
            </h4>
            {conversation.isPinned && (
              <span
                className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide bg-[rgba(116,104,232,0.18)] text-[var(--accent)]"
              >
                Pinned
              </span>
            )}
          </div>
          <p
            className="text-xs leading-relaxed ui-text-secondary"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden'
            }}
          >
            {messagePreview}
          </p>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onPin()
            }}
            className={`p-1.5 rounded-full border transition-colors ui-border-light ${conversation.isPinned ? 'text-[var(--accent)]' : 'ui-text-muted hover:text-[var(--accent)]'}`}
          >
            <Pin size={14} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-1.5 rounded-full border transition-colors ui-border-light ui-text-muted hover:text-[var(--error)]"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] ui-text-muted">
        <span>{conversation.messageCount} message{conversation.messageCount === 1 ? '' : 's'}</span>
        <span>{conversation.timestamp.toLocaleDateString()}</span>
      </div>
    </div>
  )
}
