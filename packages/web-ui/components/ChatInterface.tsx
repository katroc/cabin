'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Send, StopCircle } from 'lucide-react'
import SmartResponse from './SmartResponse'
import ExportDropdown from './ExportDropdown'
import PersonaSelector from './PersonaSelector'
import { useUIPreferences, PersonaType, ChatMode } from './contexts/UIPreferencesProvider'

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
  const { preferences, setPersona, setChatMode } = useUIPreferences()
  const { persona, chatMode } = preferences
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const lastAssistantIdRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const messages = conversation?.messages ?? []

  useEffect(() => {
    setInput('')
    setIsProcessing(false)
    setStreamingMessageId(null)
    lastAssistantIdRef.current = null
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    // Focus input when conversation changes
    inputRef.current?.focus()
  }, [conversation?.id])

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
      let aggregated = ''
      let citations: any[] = []
      let lastUpdate = 0
      let hasParsedCitations = false

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })

        // Check if this is the metadata chunk
        if (chunk.includes('---METADATA---')) {
          const metadataMatch = chunk.match(/---METADATA---(\{.*?\})---END---/)
          if (metadataMatch) {
            try {
              const metadata = JSON.parse(metadataMatch[1])
              citations = metadata.citations || []
              // Immediately update the message with citations when we receive them
              updateAssistantMessage(assistantId, message => ({
                ...message,
                citations: citations,
                rendered_citations: metadata.rendered_citations || []
              }))
            } catch (e) {
              console.warn('Failed to parse streaming metadata:', e)
            }
          }
          // Add the chunk to aggregated but remove any metadata parts
          const cleanChunk = chunk.replace(/---METADATA---\{.*?\}---END---/g, '')
          aggregated += cleanChunk
        } else {
          aggregated += chunk
        }

        // Throttle updates for smoother streaming - update at most every 50ms
        const now = Date.now()
        if (now - lastUpdate > 50 || done) {
          const currentText = aggregated
          updateAssistantMessage(assistantId, message => ({
            ...message,
            content: currentText,
            // Preserve existing citations if they exist
            citations: message.citations || [],
            rendered_citations: message.rendered_citations || []
          }))
          lastUpdate = now

          // Small delay to create smoother visual flow
          await new Promise(resolve => setTimeout(resolve, 8))
        }
      }

      // Ensure final update with complete text
      updateAssistantMessage(assistantId, message => ({
        ...message,
        content: aggregated,
        citations: message.citations || [],
        rendered_citations: message.rendered_citations || []
      }))

      setStreamingMessageId(null)
      abortControllerRef.current = null
      return aggregated
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
      // Streaming failed, fall back to regular endpoint
      try {
        const fullResponse = await requestFullResponse(question)

        // Hide verification animation if this wasn't actually a RAG request
        if (!fullResponse.used_rag) {
              }

        updateAssistantMessage(assistantMessageId, message => ({
          ...message,
          content: fullResponse.response || 'No response received',
          citations: fullResponse.citations || [],
          rendered_citations: fullResponse.rendered_citations || [],
          timestamp: new Date()
        }))

        // Clear verification animation now that citations are populated
          } catch (error) {
        console.error('Both streaming and regular endpoints failed:', error)
        updateAssistantMessage(assistantMessageId, message => ({
          ...message,
          content: 'Sorry, I encountered an error processing your request.',
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

  return (
    <div className="flex h-full min-h-0 w-full flex-col ui-bg-primary">
      <div
        className="sticky top-0 z-10 flex justify-end border-b px-4 py-3 sm:px-6 ui-bg-primary/95 backdrop-blur border-[color:var(--border-faint)]"
      >
        <ExportDropdown
          onDownloadConversation={onDownloadConversation}
          disabled={!hasMessages}
        />
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
            return (
              <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={isUser ? 'max-w-xl space-y-2' : 'w-full space-y-2'}>
                  <div className={isUser ? "px-3 py-2 border rounded-lg ui-border-light" : "py-2"}>
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
                        isVerifyingSources={false}
                        isStreaming={streamingMessageId === message.id}
                      />
                    )}
                  </div>
                  <div
                    className={`flex items-center gap-2 text-xs ${isUser ? 'justify-end' : 'justify-start'} ui-text-muted`}
                  >
                    <span>{isUser ? 'You' : 'Cabin Assistant'}</span>
                    <span>•</span>
                    <span>{message.timestamp.toLocaleTimeString()}</span>
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
              rows={2}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={chatMode === 'rag' ? "Ask about your documentation..." : "Chat with AI..."}
              className="w-full resize-none bg-transparent text-base leading-relaxed focus:outline-none ui-text-primary"
              disabled={isProcessing && !canStop}
              autoFocus
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs ui-text-muted">
                Press Enter to send · Shift + Enter for a new line
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
    </div>
  )
}
