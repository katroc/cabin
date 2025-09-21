'use client'

import Image from 'next/image'
import { useCallback, useEffect, useMemo, useState } from 'react'
import ConversationHistory from '../components/ConversationHistory'
import ChatInterface from '../components/ChatInterface'
import SettingsDrawer from '../components/SettingsDrawer'
import DataSourceSelector from '../components/DataSourceSelector'
import PerformanceDashboard from '../components/PerformanceDashboard'
import { Settings, Database, MessageSquare, X, Activity } from 'lucide-react'

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
  const [isDataSourceSelectorOpen, setIsDataSourceSelectorOpen] = useState(false)
  const [isPerformanceDashboardOpen, setIsPerformanceDashboardOpen] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
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
    setIsSidebarOpen(false)
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
        setActiveConversationId(updated[0]?.id ?? null)
      }
      setIsSidebarOpen(false)
      return updated
    })
  }

  const handleDeleteAllConversations = () => {
    setConversations([])
    setActiveConversationId(null)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY)
    }
    setIsSidebarOpen(false)
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

  const handleSelectConversation = useCallback(
    (id: string) => {
      setActiveConversationId(id)
      setIsSidebarOpen(false)
    },
    []
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
    <main className="h-[100dvh] grid grid-rows-[auto,1fr] ui-bg-primary overflow-hidden">
      <header
        className="relative flex items-center justify-between border-b px-4 py-3 sm:px-6 sm:py-3 ui-bg-secondary border-[color:var(--border-faint)]"
      >
        <div className="flex items-center">
          <Image
            src="/cabin_logo.png"
            alt="Cabin logo"
            width={144}
            height={48}
            priority
            className="h-12 w-36"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="header-button p-2 rounded-lg transition-colors md:hidden ui-text-secondary"
            title="Conversations"
            aria-label="Open conversations"
          >
            <MessageSquare size={20} />
          </button>
          <button
            onClick={() => setIsDataSourceSelectorOpen(true)}
            className="header-button p-2 rounded-lg transition-colors ui-text-secondary"
            title="Add Data Source"
          >
            <Database size={20} />
          </button>
          <button
            onClick={() => setIsPerformanceDashboardOpen(true)}
            className="header-button p-2 rounded-lg transition-colors ui-text-secondary"
            title="Performance Dashboard"
          >
            <Activity size={20} />
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="header-button p-2 rounded-lg transition-colors ui-text-secondary"
            title="Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>
      <div className="relative grid grid-rows-[1fr] min-h-0 md:grid-cols-[320px,1fr] overflow-hidden">
        <div className="hidden h-full md:flex md:flex-col md:min-h-0 md:overflow-hidden">
          <ConversationHistory
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={handleSelectConversation}
            onPinConversation={handlePinConversation}
            onDeleteConversation={handleDeleteConversation}
            onNewConversation={handleNewConversation}
            onDeleteAllConversations={handleDeleteAllConversations}
          />
        </div>
        <div className="relative h-full overflow-hidden min-h-0">
          <ChatInterface
            conversation={activeConversation}
            onMessagesChange={setActiveConversationMessages}
            onDownloadConversation={handleDownloadConversation}
            onConversationTitleChange={handleConversationTitleUpdate}
          />
        </div>

        {isSidebarOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden" role="dialog" aria-modal="true">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setIsSidebarOpen(false)}
            />
            <div className="relative ml-auto flex h-full w-full max-w-xs flex-col ui-bg-secondary shadow-2xl">
              <ConversationHistory
                conversations={conversations}
                activeConversationId={activeConversationId}
                onSelectConversation={(id) => {
                  handleSelectConversation(id)
                }}
                onPinConversation={handlePinConversation}
                onDeleteConversation={handleDeleteConversation}
                onNewConversation={handleNewConversation}
                onDeleteAllConversations={handleDeleteAllConversations}
                className="w-full border-0"
                headerActions={
                  <button
                    type="button"
                    onClick={() => setIsSidebarOpen(false)}
                    className="rounded-full border p-2 ui-border-light ui-text-secondary"
                    aria-label="Close conversations"
                  >
                    <X size={16} />
                  </button>
                }
              />
            </div>
          </div>
        )}
      </div>

      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSettingsSave}
      />

      <DataSourceSelector
        isOpen={isDataSourceSelectorOpen}
        onClose={() => setIsDataSourceSelectorOpen(false)}
      />

      <PerformanceDashboard
        isOpen={isPerformanceDashboardOpen}
        onClose={() => setIsPerformanceDashboardOpen(false)}
      />
    </main>
  )
}
