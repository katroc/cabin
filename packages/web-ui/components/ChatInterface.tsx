'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileJson, Loader2, Send, StopCircle } from 'lucide-react'
import SmartResponse from './SmartResponse'

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

export default function ChatInterface({
  conversation,
  onMessagesChange,
  onDownloadConversation,
  onConversationTitleChange
}: ChatInterfaceProps) {
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [verifyingMessageId, setVerifyingMessageId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const lastAssistantIdRef = useRef<string | null>(null)

  const messages = conversation?.messages ?? []

  useEffect(() => {
    setInput('')
    setIsProcessing(false)
    setVerifyingMessageId(null)
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
      const response = await fetch(CHAT_STREAM_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: prompt }),
        signal: controller.signal
      })

      if (!response.ok || !response.body) {
        throw new Error('Streaming not available')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let aggregated = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        aggregated += decoder.decode(value, { stream: true })
        const currentText = aggregated
        updateAssistantMessage(assistantId, message => ({
          ...message,
          content: currentText
        }))
      }

      abortControllerRef.current = null
      return aggregated
    },
    [updateAssistantMessage]
  )

  const requestFullResponse = useCallback(async (prompt: string) => {
    const controller = new AbortController()
    // Don't overwrite the main abortControllerRef during streaming
    const response = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: prompt }),
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error('Network response was not ok')
    }

    return response.json()
  }, [])

  const handleStopGeneration = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsProcessing(false)
    setVerifyingMessageId(null)
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
    

    let streamedText = ''
    let streamingFailed = false

    try {
      streamedText = await streamResponse(question, assistantMessageId)
    } catch (error) {
      streamingFailed = true
      if ((error as Error).name === 'AbortError') {
        return
      }
      console.warn('Streaming unavailable, falling back to standard response:', error)
    }

    try {
      // Set verification state while fetching citations
      setVerifyingMessageId(assistantMessageId)
      // Always fetch full response for citations, but handle content differently
      const fullResponse = await requestFullResponse(question)

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
    } finally {
      setIsProcessing(false)
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

  const hasMessages = messages.length > 0
  const canStop = isProcessing && Boolean(abortControllerRef.current)

  if (!conversation) {
    return (
      <div
        className="flex-1 flex items-center justify-center px-6"
        style={{ background: 'var(--bg-primary)' }}
      >
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            Select a conversation
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Choose a chat from the sidebar or start a new one to begin asking questions.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative" style={{ background: 'var(--bg-primary)' }}>
      {/* Floating export buttons */}
      <div className="absolute top-4 right-8 z-10 flex items-center gap-2">
        <button
          onClick={() => onDownloadConversation('markdown')}
          disabled={!hasMessages}
          className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
          style={{
            background: 'var(--bg-secondary)',
            borderColor: 'var(--border-light)',
            color: 'var(--text-primary)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
          }}
        >
          <Download size={16} />
          Markdown
        </button>
        <button
          onClick={() => onDownloadConversation('json')}
          disabled={!hasMessages}
          className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
          style={{
            background: 'var(--bg-secondary)',
            borderColor: 'var(--border-light)',
            color: 'var(--text-primary)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
          }}
        >
          <FileJson size={16} />
          JSON
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative">
        <div className="h-full overflow-y-auto pr-6 sm:pr-10 pt-6 pb-44" style={{ scrollbarGutter: 'stable' }}>
          <div className="mx-auto w-full max-w-4xl space-y-5">
            {!hasMessages && (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <h3 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
                  Cabin Assistant is ready
                </h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Ask a question or share an update whenever you're ready to begin.
                </p>
              </div>
            )}

            {messages.map((message, index) => {
              const isUser = message.role === 'user'
              return (
                <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className={isUser ? 'max-w-xl space-y-2' : 'w-full space-y-2'}>
                    <div className={isUser ? "py-2 px-3 rounded-lg border" : "py-2"} style={isUser ? { borderColor: 'var(--border-light)' } : {}}>
                      {isUser ? (
                        <p className="whitespace-pre-wrap text-base leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                          {message.content}
                        </p>
                      ) : (
                        <SmartResponse
                          answer={message.content}
                          query={messages[index - 1]?.content || ''}
                          citations={message.citations || []}
                          isVerifyingSources={verifyingMessageId === message.id}
                        />
                      )}
                    </div>
                    <div
                      className={`text-xs flex items-center gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <span>{isUser ? 'You' : 'Cabin Assistant'}</span>
                      <span>•</span>
                      <span>{message.timestamp.toLocaleTimeString()}</span>
                    </div>
                  </div>
                </div>
              )
            })}

            {streamingPlaceholderVisible && (
              <div className="flex justify-start">
                <div className="w-full">
                  <div
                    className="rounded-xl border px-4 py-5 text-center"
                    style={{
                      background: 'var(--bg-secondary)',
                      borderColor: 'var(--border-faint)'
                    }}
                  >
                    <Loader2 className="mx-auto animate-spin" style={{ color: 'var(--accent)' }} />
                    <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Generating response...
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-6 pr-[calc(1.5rem+8px)] sm:pr-[calc(2.5rem+8px)]">
          <div className="mx-auto w-full max-w-6xl px-6 sm:px-10">
            <div className="w-full">
              <form onSubmit={handleSubmit} className="pointer-events-auto">
              <div
                className="border rounded-2xl px-4 py-2.5 sm:px-5 sm:py-3 shadow-lg"
                style={{
                  background: 'var(--bg-secondary)',
                  borderColor: 'var(--border-light)',
                  boxShadow: '0 18px 42px rgba(15, 23, 42, 0.16)'
                }}
              >
                <textarea
                  rows={2}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="Ask about your documentation..."
                  className="w-full resize-none bg-transparent text-base leading-relaxed focus:outline-none"
                  style={{ color: 'var(--text-primary)' }}
                  disabled={isProcessing && !canStop}
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Press Enter to send · Shift + Enter for a new line
                  </div>
                  <div className="flex items-center gap-2">
                    {canStop && (
                      <button
                        type="button"
                        onClick={handleStopGeneration}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs sm:text-sm rounded-full border transition-colors"
                        style={{
                          borderColor: 'var(--border-light)',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        <StopCircle size={16} />
                        Stop
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={!input.trim() || isProcessing}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        background: 'var(--accent)',
                        color: 'white'
                      }}
                    >
                      <Send size={18} />
                      Send
                    </button>
                  </div>
                </div>
              </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
