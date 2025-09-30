'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Send, StopCircle, BookOpen, Copy, RefreshCw, Check } from 'lucide-react'
import SmartResponse from './SmartResponse'
import ExportDropdown from './ExportDropdown'
import PersonaSelector from './PersonaSelector'
import { useUIPreferences, PersonaType, ChatMode } from './contexts/UIPreferencesProvider'
import ConversationSourcesPanel, { AggregatedSource } from './ConversationSourcesPanel'
import { splitThinking, deriveAnswerFromThinking } from '../utils/thinking'

interface Citation {
  id: string
  page_title: string
  space_name?: string
  source_url?: string
  url?: string
  quote?: string
  page_section?: string
  last_modified?: string
  chunk_id?: string
  page_version?: number
}

interface RenderedCitation {
  index: number
  chunk_id: string
  title: string
  url: string
  quote: string
  space?: string
  page_version?: number
  merged_from?: number
  all_chunk_ids?: string[]
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  citations?: Citation[]
  rendered_citations?: RenderedCitation[]
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

interface ChatInterfaceProps {
  conversation: Conversation | null
  onMessagesChange: (updater: (messages: Message[]) => Message[]) => void
  onDownloadConversation: (format: 'json' | 'markdown') => void
  onConversationTitleChange: (title: string) => void
}

const CHAT_ENDPOINT = 'http://localhost:8788/api/chat'
const CHAT_STREAM_ENDPOINT = 'http://localhost:8788/api/chat/stream'
const CHAT_DIRECT_ENDPOINT = 'http://localhost:8788/api/chat/direct'
const CHAT_DIRECT_STREAM_ENDPOINT = 'http://localhost:8788/api/chat/direct/stream'


export default function ChatInterface({
  conversation,
  onMessagesChange,
  onDownloadConversation,
  onConversationTitleChange
}: ChatInterfaceProps) {
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [isSourcesPanelOpen, setIsSourcesPanelOpen] = useState(false)
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const { preferences, setPersona, setChatMode } = useUIPreferences()
  const { persona, chatMode } = preferences
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const lastAssistantIdRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const messages = conversation?.messages ?? []

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
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    // Focus input when conversation changes
    inputRef.current?.focus()
  }, [conversation?.id])

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

  useEffect(() => {
    if (!conversation) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation?.messages, conversation?.id])


  const updateAssistantMessage = useCallback(
    (assistantId: string, updater: (message: Message) => Message) => {
      onMessagesChange(prevMessages =>
        prevMessages.map(message => (message.id === assistantId ? updater(message) : message))
      )
    },
    [onMessagesChange]
  )

  const streamResponse = useCallback(
    async (prompt: string, assistantId: string): Promise<string> => {
      const controller = new AbortController()
      abortControllerRef.current = controller
      setStreamingMessageId(assistantId)

      const endpoint = chatMode === 'rag' ? CHAT_STREAM_ENDPOINT : CHAT_DIRECT_STREAM_ENDPOINT
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: prompt,
          conversation_id: conversation?.id,
          persona: persona
        }),
        signal: controller.signal
      })

      if (!response.ok || !response.body) {
        setStreamingMessageId(null)
        throw new Error('Streaming not available')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let rawResponse = ''
      let visibleResponse = ''
      let thinkingContent = ''
      let citations: any[] = []
      let renderedCitations: any[] = []
      let lastUpdate = 0

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        let cleanChunk = chunk

        if (chunk.includes('---METADATA---')) {
          const metadataRegex = /---METADATA---(\{.*?\})---END---/g
          let metadataMatch: RegExpExecArray | null
          while ((metadataMatch = metadataRegex.exec(chunk)) !== null) {
            try {
              const metadata = JSON.parse(metadataMatch[1])
              citations = metadata.citations || []
              renderedCitations = metadata.rendered_citations || []
              if (typeof metadata.thinking === 'string') {
                thinkingContent = metadata.thinking
              }
              updateAssistantMessage(assistantId, message => ({
                ...message,
                citations,
                rendered_citations: renderedCitations,
                thinking: thinkingContent || message.thinking
              }))
            } catch (err) {
              console.warn('Failed to parse streaming metadata:', err)
            }
          }
          cleanChunk = chunk.replace(metadataRegex, '')
        }

        if (cleanChunk) {
          rawResponse += cleanChunk
          const split = splitThinking(rawResponse)
          const answer = split.answer.trim()
          const thinking = split.thinking.trim()

          let nextVisible = answer
          if (!nextVisible && thinking) {
            nextVisible = deriveAnswerFromThinking(thinking, false)
          }
          visibleResponse = nextVisible || ''
          if (thinking) {
            thinkingContent = thinking
          }
        }

        const now = Date.now()
        if (now - lastUpdate > 50) {
          updateAssistantMessage(assistantId, message => ({
            ...message,
            content: visibleResponse,
            thinking: thinkingContent || message.thinking,
            citations: message.citations?.length ? message.citations : citations,
            rendered_citations: message.rendered_citations?.length
              ? message.rendered_citations
              : renderedCitations
          }))
          lastUpdate = now
          await new Promise(resolve => setTimeout(resolve, 8))
        }
      }

      updateAssistantMessage(assistantId, message => ({
        ...message,
        content: visibleResponse,
        thinking: thinkingContent || message.thinking,
        citations: message.citations?.length ? message.citations : citations,
        rendered_citations: message.rendered_citations?.length
          ? message.rendered_citations
          : renderedCitations
      }))

      setStreamingMessageId(null)
      abortControllerRef.current = null
      return visibleResponse
    },
    [chatMode, persona, updateAssistantMessage]
  )

  const requestFullResponse = useCallback(async (prompt: string) => {
    const controller = new AbortController()
    // Don't overwrite the main abortControllerRef during streaming
    const endpoint = chatMode === 'rag' ? CHAT_ENDPOINT : CHAT_DIRECT_ENDPOINT
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: prompt,
        conversation_id: conversation?.id,
        persona: persona
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error('Network response was not ok')
    }

    return response.json()
  }, [chatMode, persona])

  const handleStopGeneration = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsProcessing(false)
    setStreamingMessageId(null)
    lastAssistantIdRef.current = null
  }, [])

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

    // Show verification animation for potential RAG requests (we'll hide it if it's not RAG)
    if (chatMode === 'rag') {
    }

    let streamedText = ''
    let streamingFailed = false

    try {
      streamedText = await streamResponse(question, assistantMessageId)
    } catch (error) {
      streamingFailed = true
      setStreamingMessageId(null)
      if ((error as Error).name === 'AbortError') {
        return
      }
      console.warn('Streaming unavailable, falling back to standard response:', error)
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
        if (!visible) {
          visible = 'No response received'
        }

        updateAssistantMessage(assistantMessageId, message => ({
          ...message,
          content: visible,
          thinking,
          citations: fullResponse.citations || [],
          rendered_citations: fullResponse.rendered_citations || [],
          timestamp: new Date()
        }))
      } catch (error) {
        console.error('Both streaming and regular endpoints failed:', error)
        updateAssistantMessage(assistantMessageId, message => ({
          ...message,
          content: 'Sorry, I encountered an error processing your request.',
          thinking: '',
          citations: [],
          rendered_citations: [],
          timestamp: new Date()
        }))
      }
    } else {
      // Streaming succeeded and citations were already added during streaming
      // Just add timestamp and clear verification animation
      updateAssistantMessage(assistantMessageId, message => ({
        ...message,
        timestamp: new Date()
      }))
      }

    // Cleanup
    setIsProcessing(false);
    setStreamingMessageId(null);
    abortControllerRef.current = null;
    lastAssistantIdRef.current = null;
    // Refocus input after message is sent
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [
    conversation,
    input,
    isProcessing,
    onConversationTitleChange,
    onMessagesChange,
    requestFullResponse,
    streamResponse,
    updateAssistantMessage
  ])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    await sendMessage()
  }

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    } else if (event.key === 'Tab') {
      event.preventDefault()
      setChatMode(chatMode === 'rag' ? 'llm' : 'rag')
    }
  }

  const handleCopyMessage = useCallback((messageId: string, content: string) => {
    navigator.clipboard.writeText(content)
    setCopiedMessageId(messageId)
    setTimeout(() => setCopiedMessageId(null), 2000)
  }, [])

  const handleRegenerateResponse = useCallback(async (messageId: string) => {
    if (!conversation || isProcessing) return

    // Find the message and its index
    const messageIndex = messages.findIndex(msg => msg.id === messageId)
    if (messageIndex === -1 || messageIndex === 0) return

    // Get the user message that prompted this response
    const userMessage = messages[messageIndex - 1]
    if (!userMessage || userMessage.role !== 'user') return

    // Remove the assistant message and everything after it
    onMessagesChange(prev => prev.slice(0, messageIndex))

    // Create a new assistant message
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
      if ((error as Error).name === 'AbortError') {
        return
      }
      console.warn('Streaming unavailable, falling back to standard response:', error)
    }

    if (streamingFailed || !streamedText) {
      try {
        const fullResponse = await requestFullResponse(userMessage.content)
        const rawAnswer = typeof fullResponse.response === 'string' ? fullResponse.response : ''
        const thinking = typeof fullResponse.thinking === 'string' ? fullResponse.thinking : ''
        let visible = rawAnswer.trim()
        if (!visible && thinking) {
          visible = deriveAnswerFromThinking(thinking)
        }
        if (!visible) {
          visible = 'No response received'
        }

        updateAssistantMessage(newAssistantId, message => ({
          ...message,
          content: visible,
          thinking,
          citations: fullResponse.citations || [],
          rendered_citations: fullResponse.rendered_citations || [],
          timestamp: new Date()
        }))
      } catch (error) {
        console.error('Regeneration failed:', error)
        updateAssistantMessage(newAssistantId, message => ({
          ...message,
          content: 'Sorry, I encountered an error regenerating the response.',
          thinking: '',
          citations: [],
          rendered_citations: [],
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
    abortControllerRef.current = null
    lastAssistantIdRef.current = null
  }, [conversation, isProcessing, messages, onMessagesChange, streamResponse, requestFullResponse, updateAssistantMessage])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const streamingPlaceholderVisible = useMemo(() => {
    if (!isProcessing) return false
    if (!lastAssistantIdRef.current) return false
    const assistantMessage = messages.find(msg => msg.id === lastAssistantIdRef.current)
    return !assistantMessage?.content
  }, [isProcessing, messages])

  const placeholderState = useMemo(() => {
    if (streamingPlaceholderVisible) return "streaming"
    return null
  }, [streamingPlaceholderVisible])

  const hasMessages = messages.length > 0
  const canStop = isProcessing && Boolean(abortControllerRef.current)
  const totalSourceMentions = useMemo(
    () => aggregatedSources.reduce((acc, source) => acc + source.usageCount, 0),
    [aggregatedSources]
  )
  const sourcesButtonClasses = aggregatedSources.length
    ? 'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ui-bg-secondary ui-border-light ui-text-secondary hover:text-white hover:border-[var(--accent)]'
    : 'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ui-bg-secondary ui-border-light ui-text-muted opacity-50 cursor-not-allowed'

  return (
    <div className="flex h-full min-h-0 w-full flex-col ui-bg-primary">
      <div
        className="sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3 sm:px-6 ui-bg-primary/95 backdrop-blur border-[color:var(--border-faint)]"
      >
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

      <div className="flex-1 overflow-y-auto px-4 pb-10 pt-6 sm:px-10 min-h-0">
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

          {messages.map((message, index) => {
            const isUser = message.role === 'user'
            const isHovered = hoveredMessageId === message.id
            const isCopied = copiedMessageId === message.id
            const canRegenerate = !isUser && !isProcessing && index > 0

            return (
              <div
                key={message.id}
                className={`flex ${isUser ? 'justify-end' : 'justify-start'} group`}
                onMouseEnter={() => setHoveredMessageId(message.id)}
                onMouseLeave={() => setHoveredMessageId(null)}
              >
                <div className={isUser ? 'max-w-xl space-y-2' : 'w-full space-y-2'}>
                  <div className={isUser ? "px-3 py-2 border rounded-lg ui-border-light ui-bg-secondary" : "py-2"}>
                    {isUser ? (
                      <p className="whitespace-pre-wrap text-base leading-relaxed ui-text-primary">
                        {message.content}
                      </p>
                    ) : (
                      <SmartResponse
                        answer={message.content}
                        query={messages[index - 1]?.content || ''}
                        citations={message.citations || []}
                        renderedCitations={message.rendered_citations || []}
                        thinking={message.thinking || ''}
                        isVerifyingSources={false}
                        isStreaming={streamingMessageId === message.id}
                      />
                    )}
                  </div>
                  <div
                    className={`flex items-center justify-between gap-2 text-xs ui-text-muted`}
                  >
                    <div className={`flex items-center gap-2 ${isUser ? 'ml-auto' : ''}`}>
                      <span>{isUser ? 'You' : 'Cabin Assistant'}</span>
                      <span>•</span>
                      <span>{message.timestamp.toLocaleTimeString()}</span>
                    </div>

                    {/* Message Actions */}
                    {(isHovered || isCopied) && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleCopyMessage(message.id, message.content)}
                          className="message-action-button"
                          aria-label="Copy message"
                          title="Copy message"
                        >
                          {isCopied ? (
                            <Check size={14} />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                        {canRegenerate && (
                          <button
                            onClick={() => handleRegenerateResponse(message.id)}
                            className="message-action-button"
                            aria-label="Regenerate response"
                            title="Regenerate response"
                          >
                            <RefreshCw size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {placeholderState && (
            <div className="flex justify-start">
              <div className="w-full">
                <div className="rounded-xl border px-4 py-5 ui-bg-secondary ui-border-faint">
                  <div className="text-center">
                    <Loader2 className="mx-auto animate-spin text-[var(--accent)]" />
                    <p className="mt-3 text-sm ui-text-secondary">
                      Generating response...
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <footer
        className="px-4 pb-4 sm:pl-10 sm:pr-[calc(2.5rem+8px)] md:pl-10 md:pr-[calc(2.5rem+8px)] pt-0 bg-transparent"
        style={{
          paddingBottom: 'max(1rem, calc(1rem + env(safe-area-inset-bottom, 0)))'
        }}
      >
        <form onSubmit={handleSubmit} className="mx-auto w-full max-w-[min(65vw,62rem)]">
          <div
            className="w-full rounded-2xl border px-4 py-2.5 sm:px-5 ui-bg-secondary ui-border-light ui-shadow-elevated"
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(event) => {
                setInput(event.target.value)
                // Auto-resize textarea
                const target = event.target
                target.style.height = 'auto'
                target.style.height = `${Math.min(target.scrollHeight, 200)}px`
              }}
              onKeyDown={handleComposerKeyDown}
              placeholder={chatMode === 'rag' ? "Ask about your documentation..." : "Chat with AI..."}
              className="w-full resize-none bg-transparent text-base leading-relaxed focus:outline-none ui-text-primary max-h-[200px] overflow-y-auto"
              disabled={isProcessing && !canStop}
              autoFocus
              style={{ minHeight: '40px' }}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-xs ui-text-muted">
                <span>Press Enter to send · Shift + Enter for a new line</span>
                {input.length > 0 && (
                  <span className={input.length > 4000 ? 'text-orange-500' : ''}>
                    {input.length} chars
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {/* Persona Selector */}
                <PersonaSelector value={persona} onChange={setPersona} />
                {canStop && (
                  <button
                    type="button"
                    onClick={handleStopGeneration}
                    className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition ui-bg-secondary ui-border-light ui-text-secondary"
                  >
                    <StopCircle size={14} />
                    Stop
                  </button>
                )}

                {/* RAG/LLM Toggle */}
                <div
                  className="relative flex items-center bg-[var(--bg-tertiary)] rounded-full border ui-border-light p-0.5 cursor-pointer"
                  onClick={() => setChatMode(chatMode === 'rag' ? 'llm' : 'rag')}
                >
                  {/* Sliding background indicator */}
                  <div
                    className={`absolute top-0.5 bottom-0.5 rounded-full transition-all duration-200 ease-in-out ${
                      chatMode === 'rag'
                        ? 'left-0.5 right-1/2 bg-[var(--accent)]'
                        : 'left-1/2 right-0.5 bg-orange-500'
                    }`}
                  />

                  {/* Toggle options */}
                  <div
                    className={`relative z-10 px-2.5 py-1 text-xs font-medium rounded-full transition-colors duration-200 ${
                      chatMode === 'rag'
                        ? 'text-white'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    RAG
                  </div>
                  <div
                    className={`relative z-10 px-2.5 py-1 text-xs font-medium rounded-full transition-colors duration-200 ${
                      chatMode === 'llm'
                        ? 'text-white'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    LLM
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!input.trim()}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200 disabled:opacity-50 text-white ui-shadow-elevated ${
                    chatMode === 'rag' ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] border-[var(--accent)]' : 'bg-orange-500 hover:bg-orange-600 border-orange-500'
                  }`}
                >
                  <Send size={16} />
                  Send
                </button>
              </div>
            </div>
          </div>
        </form>
      </footer>

      <ConversationSourcesPanel
        open={isSourcesPanelOpen}
        onClose={() => setIsSourcesPanelOpen(false)}
        sources={aggregatedSources}
      />
    </div>
  )
}
