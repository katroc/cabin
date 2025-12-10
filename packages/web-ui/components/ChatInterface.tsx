'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ArrowDown } from 'lucide-react'
import ExportDropdown from './ExportDropdown'
import { useUIPreferences } from './contexts/UIPreferencesProvider'
import ConversationSourcesPanel, { AggregatedSource } from './ConversationSourcesPanel'
import { deriveAnswerFromThinking } from '../utils/thinking'
import { MessageBubble } from './chat'
import ChatComposer from './chat/ChatComposer'
import { useChatStream, Message, Citation, RenderedCitation } from '../app/hooks/useChatStream'

interface Conversation {
  id: string
  title: string
  lastMessage: string
  timestamp: Date
  isPinned: boolean
  messageCount: number
  messages: Message[]
}

interface ChatInterfaceProps {
  conversation: Conversation | null
  onMessagesChange: (updater: (messages: Message[]) => Message[]) => void
  onDownloadConversation: (format: 'json' | 'markdown') => void
  onConversationTitleChange: (title: string) => void
}

export default function ChatInterface({
  conversation,
  onMessagesChange,
  onDownloadConversation,
  onConversationTitleChange
}: ChatInterfaceProps) {
  const [input, setInput] = useState('')
  const [isSourcesPanelOpen, setIsSourcesPanelOpen] = useState(false)
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [isAutoScrolling, setIsAutoScrolling] = useState(true)
  const { preferences, setPersona, setChatMode } = useUIPreferences()
  const { persona, chatMode } = preferences
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const lastAssistantIdRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const messages = conversation?.messages ?? []

  // Update message helper
  const updateAssistantMessage = useCallback(
    (assistantId: string, updater: (message: Message) => Message) => {
      onMessagesChange(prevMessages =>
        prevMessages.map(message => (message.id === assistantId ? updater(message) : message))
      )
    },
    [onMessagesChange]
  )

  // Use the chat stream hook
  const {
    isProcessing,
    streamingMessageId,
    abortController,
    streamResponse,
    requestFullResponse,
    stopGeneration,
    setIsProcessing,
    setStreamingMessageId,
  } = useChatStream({
    conversationId: conversation?.id,
    chatMode,
    persona,
    onUpdateMessage: updateAssistantMessage,
  })

  // Aggregate sources from conversation
  const aggregatedSources = useMemo<AggregatedSource[]>(() => {
    if (!conversation) return []
    const map = new Map<string, AggregatedSource>()

    for (const message of conversation.messages) {
      if (message.role !== 'assistant') continue

      const citations = (message.rendered_citations && message.rendered_citations.length > 0
        ? message.rendered_citations
        : message.citations) || []

      if (citations.length === 0) continue

      const timestamp = message.timestamp instanceof Date
        ? message.timestamp
        : new Date(message.timestamp)

      citations.forEach((citation, index) => {
        const resolvedTitle = ('title' in citation && citation.title)
          || (citation as any).page_title
          || citation.source_url
          || citation.url
          || `Source ${index + 1}`

        const resolvedUrl = citation.url || (citation as any).source_url || undefined
        const key = `${resolvedUrl || resolvedTitle || index}`
        const existing = map.get(key)
        const trimmedQuote = (citation.quote || '').trim()

        if (existing) {
          existing.usageCount += 1
          existing.lastUsed = timestamp
          if (trimmedQuote && !existing.quotes.includes(trimmedQuote) && existing.quotes.length < 3) {
            existing.quotes.push(trimmedQuote)
          }
        } else {
          map.set(key, {
            key,
            title: resolvedTitle || 'Untitled source',
            url: resolvedUrl,
            usageCount: 1,
            firstUsed: timestamp,
            lastUsed: timestamp,
            quotes: trimmedQuote ? [trimmedQuote] : []
          })
        }
      })
    }

    return Array.from(map.values()).sort(
      (a, b) => b.lastUsed.getTime() - a.lastUsed.getTime()
    )
  }, [conversation])

  // Close sources panel if no sources
  useEffect(() => {
    if (isSourcesPanelOpen && aggregatedSources.length === 0) {
      setIsSourcesPanelOpen(false)
    }
  }, [aggregatedSources.length, isSourcesPanelOpen])

  // Load draft from localStorage when conversation changes
  useEffect(() => {
    const draftKey = `draft-${conversation?.id || 'new'}`
    const savedDraft = localStorage.getItem(draftKey)
    setInput(savedDraft || '')
    setIsProcessing(false)
    setStreamingMessageId(null)
    lastAssistantIdRef.current = null
    inputRef.current?.focus()
  }, [conversation?.id, setIsProcessing, setStreamingMessageId])

  // Save draft to localStorage when input changes
  useEffect(() => {
    if (!conversation?.id) return
    const draftKey = `draft-${conversation.id}`
    if (input) {
      localStorage.setItem(draftKey, input)
    } else {
      localStorage.removeItem(draftKey)
    }
  }, [input, conversation?.id])

  // Smooth scroll during streaming - always scroll unless user has scrolled up
  useEffect(() => {
    if (!conversation || !streamingMessageId) return

    const container = messagesContainerRef.current
    if (!container) return

    // Force auto-scrolling when streaming starts
    setIsAutoScrolling(true)

    let rafId: number
    const scheduleScroll = () => {
      rafId = requestAnimationFrame(() => {
        // During streaming, keep scrolling to bottom if still auto-scrolling
        if (isAutoScrolling && streamingMessageId) {
          container.scrollTop = container.scrollHeight
        }
        if (streamingMessageId) {
          scheduleScroll()
        }
      })
    }

    scheduleScroll()
    return () => { if (rafId) cancelAnimationFrame(rafId) }
  }, [streamingMessageId, isAutoScrolling, conversation])

  // Scroll on new messages
  useEffect(() => {
    if (!conversation || streamingMessageId) return

    if (messagesContainerRef.current && messagesEndRef.current) {
      const container = messagesContainerRef.current
      const { scrollTop, scrollHeight, clientHeight } = container
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 200

      if (isNearBottom) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
      }
    }
  }, [conversation?.messages, conversation?.id, streamingMessageId])

  // Scroll detection for button
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 200
      setShowScrollButton(!isNearBottom && messages.length > 0)
      setIsAutoScrolling(isNearBottom)
    }

    container.addEventListener('scroll', handleScroll)
    handleScroll()
    return () => container.removeEventListener('scroll', handleScroll)
  }, [messages.length])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Send message handler
  const sendMessage = useCallback(async () => {
    if (!conversation) return
    const question = input.trim()
    if (!question || isProcessing) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: question,
      timestamp: new Date()
    }

    const assistantMessageId = `${Date.now()}-assistant`
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      thinking: '',
      timestamp: new Date()
    }

    lastAssistantIdRef.current = assistantMessageId
    onMessagesChange(prev => [...prev, userMessage, assistantMessage])

    if (conversation.title === 'New Conversation') {
      const truncated = question.length > 60 ? `${question.slice(0, 57)}...` : question
      onConversationTitleChange(truncated)
    }

    setInput('')
    setIsProcessing(true)

    let streamedText = ''
    let streamingFailed = false

    try {
      streamedText = await streamResponse(question, assistantMessageId)
    } catch (error) {
      streamingFailed = true
      setStreamingMessageId(null)
      if ((error as Error).name === 'AbortError') return
      console.warn('Streaming unavailable, falling back:', error)
    }

    if (streamingFailed || !streamedText) {
      try {
        const fullResponse = await requestFullResponse(question)
        const rawAnswer = typeof fullResponse.response === 'string' ? fullResponse.response : ''
        const thinking = typeof fullResponse.thinking === 'string' ? fullResponse.thinking : ''
        let visible = rawAnswer.trim()
        if (!visible && thinking) {
          visible = deriveAnswerFromThinking(thinking)
        }
        if (!visible) visible = 'No response received'

        updateAssistantMessage(assistantMessageId, message => ({
          ...message,
          content: visible,
          thinking,
          citations: fullResponse.citations || [],
          rendered_citations: fullResponse.rendered_citations || [],
          timestamp: new Date()
        }))
      } catch (error) {
        console.error('Both endpoints failed:', error)
        updateAssistantMessage(assistantMessageId, message => ({
          ...message,
          content: 'Sorry, I encountered an error processing your request.',
          timestamp: new Date()
        }))
      }
    } else {
      updateAssistantMessage(assistantMessageId, message => ({
        ...message,
        timestamp: new Date()
      }))
    }

    setIsProcessing(false)
    setStreamingMessageId(null)
    lastAssistantIdRef.current = null
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [
    conversation, input, isProcessing, onConversationTitleChange, onMessagesChange,
    requestFullResponse, streamResponse, updateAssistantMessage, setIsProcessing, setStreamingMessageId
  ])

  // Regenerate handler
  const handleRegenerateResponse = useCallback(async (messageId: string) => {
    if (!conversation || isProcessing) return

    const messageIndex = messages.findIndex(msg => msg.id === messageId)
    if (messageIndex === -1 || messageIndex === 0) return

    const userMessage = messages[messageIndex - 1]
    if (!userMessage || userMessage.role !== 'user') return

    onMessagesChange(prev => prev.slice(0, messageIndex))

    const newAssistantId = `${Date.now()}-assistant`
    const newAssistantMessage: Message = {
      id: newAssistantId,
      role: 'assistant',
      content: '',
      thinking: '',
      timestamp: new Date()
    }

    lastAssistantIdRef.current = newAssistantId
    onMessagesChange(prev => [...prev, newAssistantMessage])
    setIsProcessing(true)

    let streamedText = ''
    let streamingFailed = false

    try {
      streamedText = await streamResponse(userMessage.content, newAssistantId)
    } catch (error) {
      streamingFailed = true
      setStreamingMessageId(null)
      if ((error as Error).name === 'AbortError') return
    }

    if (streamingFailed || !streamedText) {
      try {
        const fullResponse = await requestFullResponse(userMessage.content)
        const rawAnswer = typeof fullResponse.response === 'string' ? fullResponse.response : ''
        const thinking = typeof fullResponse.thinking === 'string' ? fullResponse.thinking : ''
        let visible = rawAnswer.trim()
        if (!visible && thinking) visible = deriveAnswerFromThinking(thinking)
        if (!visible) visible = 'No response received'

        updateAssistantMessage(newAssistantId, message => ({
          ...message,
          content: visible,
          thinking,
          citations: fullResponse.citations || [],
          rendered_citations: fullResponse.rendered_citations || [],
          timestamp: new Date()
        }))
      } catch (error) {
        updateAssistantMessage(newAssistantId, message => ({
          ...message,
          content: 'Sorry, I encountered an error regenerating the response.',
          timestamp: new Date()
        }))
      }
    } else {
      updateAssistantMessage(newAssistantId, message => ({
        ...message,
        timestamp: new Date()
      }))
    }

    setIsProcessing(false)
    setStreamingMessageId(null)
    lastAssistantIdRef.current = null
  }, [conversation, isProcessing, messages, onMessagesChange, streamResponse, requestFullResponse, updateAssistantMessage, setIsProcessing, setStreamingMessageId])

  const handleCopyMessage = useCallback((messageId: string, content: string) => {
    navigator.clipboard.writeText(content)
    setCopiedMessageId(messageId)
    setTimeout(() => setCopiedMessageId(null), 2000)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopGeneration() }
  }, [stopGeneration])

  // Removed: streamingPlaceholderVisible - now using thinking bubble in SmartResponse instead

  const hasMessages = messages.length > 0
  const canStop = isProcessing && Boolean(abortController)
  const totalSourceMentions = useMemo(
    () => aggregatedSources.reduce((acc, source) => acc + source.usageCount, 0),
    [aggregatedSources]
  )
  const sourcesButtonClasses = aggregatedSources.length
    ? 'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ui-bg-secondary ui-border-light ui-text-secondary hover:text-white hover:border-[var(--accent)]'
    : 'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ui-bg-secondary ui-border-light ui-text-muted opacity-50 cursor-not-allowed'

  return (
    <div className="flex h-full min-h-0 w-full flex-col ui-bg-primary">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3 sm:px-6 ui-bg-primary/95 backdrop-blur border-[color:var(--border-faint)]">
        <div className="text-xs sm:text-sm ui-text-secondary">
          {aggregatedSources.length === 0
            ? 'No sources cited yet'
            : `${aggregatedSources.length} source${aggregatedSources.length === 1 ? '' : 's'} · ${totalSourceMentions} mention${totalSourceMentions === 1 ? '' : 's'}`}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={sourcesButtonClasses}
            onClick={() => setIsSourcesPanelOpen(true)}
            disabled={aggregatedSources.length === 0}
          >
            <BookOpen size={14} />
            Sources
          </button>
          <ExportDropdown
            onDownloadConversation={onDownloadConversation}
            disabled={!hasMessages}
          />
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 pb-10 pt-6 sm:px-10 min-h-0 relative">
        <div className="mx-auto flex w-full max-w-[min(65vw,62rem)] flex-col gap-5">
          {!hasMessages && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <h3 className="text-lg font-medium ui-text-primary">
                Cabin Assistant is ready
              </h3>
              <p className="text-sm ui-text-secondary">
                Ask a question or share an update whenever you're ready to begin.
              </p>
            </div>
          )}

          {messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              previousMessage={messages[index - 1]}
              isHovered={hoveredMessageId === message.id}
              isCopied={copiedMessageId === message.id}
              isStreaming={streamingMessageId === message.id}
              canRegenerate={message.role !== 'user' && !isProcessing && index > 0}
              onMouseEnter={() => setHoveredMessageId(message.id)}
              onMouseLeave={() => setHoveredMessageId(null)}
              onCopy={handleCopyMessage}
              onRegenerate={handleRegenerateResponse}
            />
          ))}

          {/* Removed: Generating response placeholder - now using thinking bubble in SmartResponse */}

          <div ref={messagesEndRef} />
        </div>

        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className="scroll-to-bottom-button"
            aria-label="Scroll to bottom"
          >
            <ArrowDown size={20} />
          </button>
        )}
      </div>

      {/* Composer */}
      <ChatComposer
        ref={inputRef}
        input={input}
        chatMode={chatMode}
        persona={persona}
        isProcessing={isProcessing}
        canStop={canStop}
        conversationId={conversation?.id}
        onInputChange={setInput}
        onSubmit={sendMessage}
        onStop={stopGeneration}
        onChatModeChange={setChatMode}
        onPersonaChange={setPersona}
      />

      <ConversationSourcesPanel
        open={isSourcesPanelOpen}
        onClose={() => setIsSourcesPanelOpen(false)}
        sources={aggregatedSources}
      />
    </div>
  )
}
