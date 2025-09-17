'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import ConversationHistory from '../components/ConversationHistory'
import ChatInterface from '../components/ChatInterface'
import SettingsDrawer from '../components/SettingsDrawer'
import ConfluenceIndexing from '../components/ConfluenceIndexing'
import { Settings, Database } from 'lucide-react'

interface Citation {
  id: string
  page_title: string
  space_name?: string
  source_url?: string
  page_section?: string
  last_modified?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  timestamp: Date
}

interface Conversation {
  id: string
  title: string
  lastMessage: string
  timestamp: Date
  isPinned: boolean
  messageCount: number
  messages: Message[]
}

interface SettingsData {
  llmBaseUrl: string
  llmModel: string
  embeddingBaseUrl: string
  embeddingModel: string
  temperature: number
  chromaHost: string
  chromaPort: number
  finalPassages: number
  cosineFloor: number
  minKeywordOverlap: number
  useReranker: boolean
  allowRerankerFallback: boolean
  useRm3: boolean
  rerankerUrl: string
  rerankerPort: number
  logLevel: string
}

const STORAGE_KEY = 'cabin.conversations.v1'
const SETTINGS_ENDPOINT = 'http://localhost:8788/api/settings'

const createDefaultConversation = (): Conversation => ({
  id: Date.now().toString(),
  title: 'New Conversation',
  lastMessage: '',
  timestamp: new Date(),
  isPinned: false,
  messageCount: 0,
  messages: []
})

const reviveConversations = (rawConversations: any[]): Conversation[] =>
  rawConversations.map((conv: any) => {
    const revivedMessages = (conv.messages || []).map((msg: any) => ({
      ...msg,
      timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date()
    }))

    return {
      ...conv,
      lastMessage: typeof conv.lastMessage === 'string' ? conv.lastMessage : '',
      messageCount:
        typeof conv.messageCount === 'number'
          ? conv.messageCount
          : revivedMessages.length,
      isPinned: Boolean(conv.isPinned),
      timestamp: conv.timestamp ? new Date(conv.timestamp) : new Date(),
      messages: revivedMessages
    }
  })

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isIndexingOpen, setIsIndexingOpen] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const [settings, setSettings] = useState<SettingsData>({
    llmBaseUrl: 'http://localhost:1234/v1',
    llmModel: 'openai/gpt-oss-20b',
    embeddingBaseUrl: 'http://localhost:1234/v1',
    embeddingModel: 'text-embedding-bge-m3',
    temperature: 0.1,
    chromaHost: 'localhost',
    chromaPort: 8000,
    finalPassages: 8,
    cosineFloor: 0.18,
    minKeywordOverlap: 2,
    useReranker: true,
    allowRerankerFallback: true,
    useRm3: false,
    rerankerUrl: 'http://localhost:8010/rerank',
    rerankerPort: 8010,
    logLevel: 'INFO'
  })

  useEffect(() => {
    let cancelled = false
    const fetchSettings = async () => {
      try {
        const response = await fetch(SETTINGS_ENDPOINT)
        if (!response.ok) {
          throw new Error(`Failed to fetch settings: ${response.status}`)
        }
        const data = await response.json()
        if (cancelled) return
        setSettings({
          llmBaseUrl: data.llmBaseUrl || settings.llmBaseUrl,
          llmModel: data.llmModel || settings.llmModel,
          embeddingBaseUrl: data.embeddingBaseUrl || settings.embeddingBaseUrl,
          embeddingModel: data.embeddingModel || settings.embeddingModel,
          temperature: typeof data.temperature === 'number' ? data.temperature : settings.temperature,
          chromaHost: data.chromaHost || settings.chromaHost,
          chromaPort: typeof data.chromaPort === 'number' ? data.chromaPort : settings.chromaPort,
          finalPassages: typeof data.finalPassages === 'number' ? data.finalPassages : settings.finalPassages,
          cosineFloor: typeof data.cosineFloor === 'number' ? data.cosineFloor : settings.cosineFloor,
          minKeywordOverlap: typeof data.minKeywordOverlap === 'number' ? data.minKeywordOverlap : settings.minKeywordOverlap,
          useReranker: typeof data.useReranker === 'boolean' ? data.useReranker : settings.useReranker,
          allowRerankerFallback: typeof data.allowRerankerFallback === 'boolean' ? data.allowRerankerFallback : settings.allowRerankerFallback,
          useRm3: typeof data.useRm3 === 'boolean' ? data.useRm3 : settings.useRm3,
          rerankerUrl: data.rerankerUrl || settings.rerankerUrl,
          rerankerPort: typeof data.rerankerPort === 'number' ? data.rerankerPort : settings.rerankerPort,
          logLevel: data.logLevel || settings.logLevel,
        })
      } catch (error) {
        console.warn('Failed to load runtime settings:', error)
      }
    }

    fetchSettings()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        const storedConversations = reviveConversations(parsed.conversations || [])
        if (storedConversations.length > 0) {
          setConversations(storedConversations)
          setActiveConversationId(parsed.activeConversationId || storedConversations[0].id)
          setIsHydrated(true)
          return
        }
      }
    } catch (error) {
      console.warn('Failed to hydrate stored conversations:', error)
    }

    const fallback = createDefaultConversation()
    setConversations([fallback])
    setActiveConversationId(fallback.id)
    setIsHydrated(true)
  }, [])

  useEffect(() => {
    if (!isHydrated || typeof window === 'undefined') return

    try {
      const payload = {
        conversations: conversations.map(conv => ({
          ...conv,
          timestamp: conv.timestamp.toISOString(),
          messages: conv.messages.map(msg => ({
            ...msg,
            timestamp: msg.timestamp.toISOString()
          }))
        })),
        activeConversationId
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch (error) {
      console.warn('Failed to persist conversations:', error)
    }
  }, [conversations, activeConversationId, isHydrated])

  const activeConversation = useMemo(
    () => conversations.find(conv => conv.id === activeConversationId) || null,
    [conversations, activeConversationId]
  )

  const setActiveConversationMessages = useCallback(
    (updater: (messages: Message[]) => Message[]) => {
      if (!activeConversationId) return

      setConversations(prev =>
        prev.map(conversation => {
          if (conversation.id !== activeConversationId) return conversation

          const updatedMessages = updater(conversation.messages)
          const meaningfulMessages = updatedMessages.filter(
            msg => msg.role === 'user' || msg.role === 'assistant'
          )
          const lastMeaningful = [...meaningfulMessages]
            .reverse()
            .find(msg => msg.content.trim().length > 0)

          return {
            ...conversation,
            messages: updatedMessages,
            messageCount: meaningfulMessages.length,
            lastMessage: lastMeaningful?.content || '',
            timestamp: new Date()
          }
        })
      )
    },
    [activeConversationId]
  )

  const handleNewConversation = () => {
    const newConversation = createDefaultConversation()
    setConversations(prev => [newConversation, ...prev])
    setActiveConversationId(newConversation.id)
  }

  const handlePinConversation = (id: string) => {
    setConversations(prev =>
      prev.map(conv => (conv.id === id ? { ...conv, isPinned: !conv.isPinned } : conv))
    )
  }

  const handleDeleteConversation = (id: string) => {
    setConversations(prev => {
      const updated = prev.filter(conv => conv.id !== id)
      if (updated.length === 0) {
        setActiveConversationId(null)
        return updated
      }

      if (activeConversationId === id) {
        setActiveConversationId(updated[0].id)
      }
      return updated
    })
  }

  const handleDeleteAllConversations = () => {
    setConversations([])
    setActiveConversationId(null)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  }

  const handleDownloadConversation = useCallback(
    (format: 'json' | 'markdown') => {
      if (!activeConversation) return

      const serialisedConversation = {
        ...activeConversation,
        timestamp: activeConversation.timestamp.toISOString(),
        messages: activeConversation.messages.map(message => ({
          ...message,
          timestamp: message.timestamp.toISOString()
        }))
      }

      if (format === 'json') {
        const blob = new Blob([JSON.stringify(serialisedConversation, null, 2)], {
          type: 'application/json'
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${activeConversation.title || 'conversation'}.json`
        link.click()
        URL.revokeObjectURL(url)
        return
      }

      let markdown = `# ${activeConversation.title || 'Conversation'}\n\n`
      for (const message of activeConversation.messages) {
        const heading = message.role === 'user' ? '## User' : '## Assistant'
        markdown += `${heading} (${message.timestamp.toLocaleString()})\n\n`
        markdown += `${message.content || '_No content_'}\n\n`

        if (message.citations?.length) {
          markdown += '### Citations\n'
          for (const citation of message.citations) {
            const bits = [citation.page_title]
            if (citation.space_name) bits.push(`(${citation.space_name})`)
            if (citation.source_url) bits.push(citation.source_url)
            markdown += `- ${bits.filter(Boolean).join(' ')}\n`
          }
          markdown += '\n'
        }
      }

      const blob = new Blob([markdown], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${activeConversation.title || 'conversation'}.md`
      link.click()
      URL.revokeObjectURL(url)
    },
    [activeConversation]
  )

  const handleConversationTitleUpdate = useCallback(
    (title: string) => {
      if (!activeConversationId) return
      setConversations(prev =>
        prev.map(conv => (conv.id === activeConversationId ? { ...conv, title } : conv))
      )
    },
    [activeConversationId]
  )

  const handleSettingsSave = useCallback(async (nextSettings: SettingsData) => {
    setSettings(nextSettings)
    try {
      await fetch(SETTINGS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings)
      })
    } catch (error) {
      console.error('Failed to persist settings:', error)
    }
  }, [])

  return (
    <main className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <header
        className="border-b p-4 flex items-center justify-between flex-shrink-0"
        style={{
          background: 'var(--bg-secondary)',
          borderColor: 'var(--border-faint)'
        }}
      >
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          Cabin
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
      <div className="flex-1 flex overflow-hidden">
        <ConversationHistory
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelectConversation={setActiveConversationId}
          onPinConversation={handlePinConversation}
          onDeleteConversation={handleDeleteConversation}
          onNewConversation={handleNewConversation}
          onDeleteAllConversations={handleDeleteAllConversations}
        />
        <ChatInterface
          conversation={activeConversation}
          onMessagesChange={setActiveConversationMessages}
          onDownloadConversation={handleDownloadConversation}
          onConversationTitleChange={handleConversationTitleUpdate}
        />
      </div>

      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSettingsSave}
      />

      <ConfluenceIndexing
        isOpen={isIndexingOpen}
        onClose={() => setIsIndexingOpen(false)}
      />
    </main>
  )
}
