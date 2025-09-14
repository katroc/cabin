'use client'

import { useState } from 'react'
import ConversationHistory from '../components/ConversationHistory'
import ChatInterface from '../components/ChatInterface'
import SettingsDrawer from '../components/SettingsDrawer'
import ConfluenceIndexing from '../components/ConfluenceIndexing'
import { Settings, Database } from 'lucide-react'

interface Conversation {
  id: string
  title: string
  lastMessage: string
  timestamp: Date
  isPinned: boolean
  messageCount: number
}

interface SettingsData {
  llmBaseUrl: string
  embeddingBaseUrl: string
  model: string
  temperature: number
  chromaHost: string
  chromaPort: number
  topK: number
  relevanceThreshold: number
  useOptimizedPipeline: boolean
  enableIntentProcessing: boolean
}

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([
    {
      id: '1',
      title: 'Getting Started',
      lastMessage: 'How do I set up the system?',
      timestamp: new Date(),
      isPinned: true,
      messageCount: 5
    }
  ])
  const [activeConversationId, setActiveConversationId] = useState<string | null>('1')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isIndexingOpen, setIsIndexingOpen] = useState(false)
  const [settings, setSettings] = useState<SettingsData>({
    llmBaseUrl: 'http://localhost:1234',
    embeddingBaseUrl: 'http://localhost:1234',
    model: 'local-model',
    temperature: 0.7,
    chromaHost: 'localhost',
    chromaPort: 8000,
    topK: 5,
    relevanceThreshold: 0.05,
    useOptimizedPipeline: true,
    enableIntentProcessing: true
  })

  const handleNewConversation = () => {
    const newConversation: Conversation = {
      id: Date.now().toString(),
      title: 'New Conversation',
      lastMessage: '',
      timestamp: new Date(),
      isPinned: false,
      messageCount: 0
    }
    setConversations(prev => [newConversation, ...prev])
    setActiveConversationId(newConversation.id)
  }

  const handlePinConversation = (id: string) => {
    setConversations(prev =>
      prev.map(conv =>
        conv.id === id ? { ...conv, isPinned: !conv.isPinned } : conv
      )
    )
  }

  const handleDeleteConversation = (id: string) => {
    setConversations(prev => prev.filter(conv => conv.id !== id))
    if (activeConversationId === id) {
      setActiveConversationId(null)
    }
  }

  return (
    <main className="h-screen flex" style={{ background: 'var(--bg-primary)' }}>
      <ConversationHistory
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={setActiveConversationId}
        onPinConversation={handlePinConversation}
        onDeleteConversation={handleDeleteConversation}
        onNewConversation={handleNewConversation}
      />
      <div className="flex-1 flex flex-col">
        <header
          className="border-b p-4 flex items-center justify-between"
          style={{
            background: 'var(--bg-secondary)',
            borderColor: 'var(--border-faint)'
          }}
        >
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            RAG Documentation Assistant
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsIndexingOpen(true)}
              className="header-button p-2 rounded-lg transition-colors"
              style={{
                color: 'var(--text-secondary)'
              }}
              title="Confluence Indexing"
            >
              <Database size={20} />
            </button>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="header-button p-2 rounded-lg transition-colors"
              style={{
                color: 'var(--text-secondary)'
              }}
              title="Settings"
            >
              <Settings size={20} />
            </button>
          </div>
        </header>
        <ChatInterface />
      </div>

      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={setSettings}
      />

      <ConfluenceIndexing
        isOpen={isIndexingOpen}
        onClose={() => setIsIndexingOpen(false)}
      />
    </main>
  )
}