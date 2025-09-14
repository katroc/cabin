'use client'

import { useState } from 'react'
import { MessageSquare, Pin, Trash2, Search } from 'lucide-react'

interface Conversation {
  id: string
  title: string
  lastMessage: string
  timestamp: Date
  isPinned: boolean
  messageCount: number
}

interface ConversationHistoryProps {
  conversations: Conversation[]
  activeConversationId: string | null
  onSelectConversation: (id: string) => void
  onPinConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
  onNewConversation: () => void
}

export default function ConversationHistory({
  conversations,
  activeConversationId,
  onSelectConversation,
  onPinConversation,
  onDeleteConversation,
  onNewConversation
}: ConversationHistoryProps) {
  const [searchTerm, setSearchTerm] = useState('')

  const filteredConversations = conversations.filter(conv =>
    conv.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    conv.lastMessage.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const pinnedConversations = filteredConversations.filter(conv => conv.isPinned)
  const unpinnedConversations = filteredConversations.filter(conv => !conv.isPinned)

  return (
    <div
      className="w-80 border-r flex flex-col"
      style={{
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border-faint)'
      }}
    >
      <div
        className="p-4 border-b"
        style={{ borderColor: 'var(--border-faint)' }}
      >
        <button
          onClick={onNewConversation}
          className="btn-primary w-full mb-4"
        >
          New Conversation
        </button>

        <div className="relative">
          <Search size={16}
            className="absolute left-3 top-1/2 transform -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-base pl-10"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {pinnedConversations.length > 0 && (
          <div className="p-4">
            <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
              Pinned
            </h3>
            {pinnedConversations.map((conversation) => (
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
        )}

        <div className="p-4">
          <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
            {pinnedConversations.length > 0 ? 'Recent' : 'Conversations'}
          </h3>
          {unpinnedConversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isActive={conversation.id === activeConversationId}
              onSelect={() => onSelectConversation(conversation.id)}
              onPin={() => onPinConversation(conversation.id)}
              onDelete={() => onDeleteConversation(conversation.id)}
            />
          ))}

          {filteredConversations.length === 0 && (
            <div className="text-center mt-8">
              <MessageSquare size={48} className="mx-auto mb-4 opacity-50" style={{ color: 'var(--text-muted)' }} />
              <p style={{ color: 'var(--text-muted)' }}>No conversations found</p>
            </div>
          )}
        </div>
      </div>
    </div>
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
  return (
    <div
      className="p-3 mb-2 rounded-lg cursor-pointer transition-colors"
      style={{
        background: isActive ? 'var(--bg-tertiary)' : 'transparent',
        borderColor: isActive ? 'var(--accent)' : 'transparent',
        border: isActive ? '1px solid' : '1px solid transparent'
      }}
      onClick={onSelect}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'var(--bg-hover)'
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'transparent'
        }
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
            {conversation.title}
          </h4>
          <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-secondary)' }}>
            {conversation.lastMessage}
          </p>
          <div className="flex items-center mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>{conversation.messageCount} messages</span>
            <span className="mx-2">•</span>
            <span>{conversation.timestamp.toLocaleDateString()}</span>
          </div>
        </div>

        <div className="flex items-center space-x-1 ml-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPin()
            }}
            className="p-1 rounded transition-colors"
            style={{
              color: conversation.isPinned ? 'var(--accent)' : 'var(--text-muted)'
            }}
          >
            <Pin size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--error)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)'
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}