'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Send, StopCircle } from 'lucide-react'
import SmartResponse from './SmartResponse'
import ExportDropdown from './ExportDropdown'

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

type ChatMode = 'rag' | 'llm'

export default function ChatInterface({
  conversation,
  onMessagesChange,
  onDownloadConversation,
  onConversationTitleChange
}: ChatInterfaceProps) {
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [verifyingMessageId, setVerifyingMessageId] = useState<string | null>(null)
  const [routingMessageId, setRoutingMessageId] = useState<string | null>(null)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [chatMode, setChatMode] = useState<ChatMode>('rag')
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const lastAssistantIdRef = useRef<string | null>(null)

  const messages = conversation?.messages ?? []

  useEffect(() => {
    setInput('')
    setIsProcessing(false)
    setVerifyingMessageId(null)
    setRoutingMessageId(null)
    setStreamingMessageId(null)
    lastAssistantIdRef.current = null
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }, [conversation?.id])

  useEffect(() => {
    if (!conversation) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation?.messages, conversation?.id])

  // Scroll when verification state changes (animation appears/disappears)
  useEffect(() => {
    if (verifyingMessageId) {
      // Small delay to let the animation render first
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 100)
    }
  }, [verifyingMessageId])

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
          conversation_id: conversation?.id
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
      let lastUpdate = 0

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        aggregated += chunk

        // Throttle updates for smoother streaming - update at most every 50ms
        const now = Date.now()
        if (now - lastUpdate > 50 || done) {
          const currentText = aggregated
          updateAssistantMessage(assistantId, message => ({
            ...message,
            content: currentText
          }))
          lastUpdate = now

          // Small delay to create smoother visual flow
          await new Promise(resolve => setTimeout(resolve, 8))
        }
      }

      setStreamingMessageId(null)
      abortControllerRef.current = null
      return aggregated
    },
    [chatMode, updateAssistantMessage]
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
        conversation_id: conversation?.id
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error('Network response was not ok')
    }

    return response.json()
  }, [chatMode])

  const handleStopGeneration = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsProcessing(false)
    setVerifyingMessageId(null)
    setRoutingMessageId(null)
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

    // Show routing animation immediately
    setRoutingMessageId(assistantMessageId)

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

    try {
      // Always fetch full response for metadata, but handle verification animation smartly
      const fullResponse = await requestFullResponse(question)

      // Clear routing animation and show appropriate next state
      setRoutingMessageId(null)

      // Only show verification animation if response actually has citations
      if (fullResponse.citations && fullResponse.citations.length > 0) {
        setVerifyingMessageId(assistantMessageId)
        // Brief delay to show the verification happened
        await new Promise(resolve => setTimeout(resolve, 600))
      }

      if (streamingFailed || !streamedText) {
        // If streaming failed, use the full response content
        updateAssistantMessage(assistantMessageId, message => ({
          ...message,
          content: fullResponse.response || 'No response received',
          citations: fullResponse.citations || [],
          timestamp: new Date()
        }))
      } else {
        // If streaming succeeded, keep streamed content but add citations
        updateAssistantMessage(assistantMessageId, message => ({
          ...message,
          citations: fullResponse.citations || [],
          timestamp: new Date()
        }))
      }

      // Clear verification state
      setVerifyingMessageId(null)
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return
      }
      console.error('Failed to fetch complete response:', error)
      updateAssistantMessage(assistantMessageId, message => ({
        ...message,
        content: 'Sorry, I encountered an error processing your request.',
        timestamp: new Date()
      }))
      // Clear verification state on error
      setVerifyingMessageId(null)
      // Clear routing state on error
      setRoutingMessageId(null)
    } finally {
      setIsProcessing(false)
      setStreamingMessageId(null)
      abortControllerRef.current = null
      lastAssistantIdRef.current = null
    }
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
    if (routingMessageId) return "routing"
    if (streamingPlaceholderVisible) return "streaming"
    return null
  }, [routingMessageId, streamingPlaceholderVisible])

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
                        isVerifyingSources={verifyingMessageId === message.id}
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
                  {placeholderState === 'routing' ? (
                    <div className="routing-section">
                      <div className="routing-animation">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          className="routing-icon routing-loading"
                        >
                          <path d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z" />
                        </svg>
                        <span className="routing-text">Analyzing request...</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <Loader2 className="mx-auto animate-spin text-[var(--accent)]" />
                      <p className="mt-3 text-sm ui-text-secondary">
                        Generating response...
                      </p>
                    </div>
                  )}
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
              rows={2}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Ask about your documentation..."
              className="w-full resize-none bg-transparent text-base leading-relaxed focus:outline-none ui-text-primary"
              disabled={isProcessing && !canStop}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs ui-text-muted">
                Press Enter to send · Shift + Enter for a new line
              </div>
              <div className="flex items-center gap-2">
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
                  className="relative flex items-center bg-[var(--bg-tertiary)] rounded-full border ui-border-light p-1 cursor-pointer"
                  onClick={() => setChatMode(chatMode === 'rag' ? 'llm' : 'rag')}
                >
                  {/* Sliding background indicator */}
                  <div
                    className={`absolute top-1 bottom-1 rounded-full transition-all duration-200 ease-in-out ${
                      chatMode === 'rag'
                        ? 'left-1 right-1/2 bg-[var(--accent)]'
                        : 'left-1/2 right-1 bg-orange-500'
                    }`}
                  />

                  {/* Toggle options */}
                  <div
                    className={`relative z-10 px-3 py-1.5 text-xs font-medium rounded-full transition-colors duration-200 ${
                      chatMode === 'rag'
                        ? 'text-white'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    RAG
                  </div>
                  <div
                    className={`relative z-10 px-3 py-1.5 text-xs font-medium rounded-full transition-colors duration-200 ${
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
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 disabled:opacity-50 text-white ui-shadow-elevated ${
                    chatMode === 'rag' ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]' : 'bg-orange-500 hover:bg-orange-600'
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
