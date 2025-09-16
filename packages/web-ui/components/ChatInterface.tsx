'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileJson, Loader2, Send } from 'lucide-react'
import { SmartResponse } from './SmartResponse'

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
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const lastAssistantIdRef = useRef<string | null>(null)

  const messages = conversation?.messages ?? []

  useEffect(() => {
    setInput('')
    setIsProcessing(false)
    lastAssistantIdRef.current = null
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
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
    abortControllerRef.current = controller
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

    abortControllerRef.current = null
    return response.json()
  }, [])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
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
      const fullResponse = await requestFullResponse(question)
      updateAssistantMessage(assistantMessageId, message => ({
        ...message,
        content: fullResponse.response || streamedText || 'No response received',
        citations: fullResponse.citations || [],
        timestamp: new Date()
      }))
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return
      }
      console.error('Failed to fetch complete response:', error)
      if (streamedText && !streamingFailed) {
        updateAssistantMessage(assistantMessageId, message => ({
          ...message,
          content: streamedText,
          timestamp: new Date()
        }))
      } else {
        updateAssistantMessage(assistantMessageId, message => ({
          ...message,
          content: 'Sorry, I encountered an error processing your request.',
          timestamp: new Date()
        }))
      }
    } finally {
      setIsProcessing(false)
      abortControllerRef.current = null
      lastAssistantIdRef.current = null
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

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <p className="text-lg" style={{ color: 'var(--text-secondary)' }}>
          Select a conversation or start a new one to begin chatting.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <div className="flex items-center justify-end gap-2 px-8 pt-6">
        <button
          onClick={() => onDownloadConversation('markdown')}
          disabled={messages.length === 0}
          className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            borderColor: 'var(--border-faint)',
            color: 'var(--text-secondary)'
          }}
        >
          <Download size={16} />
          Markdown
        </button>
        <button
          onClick={() => onDownloadConversation('json')}
          disabled={messages.length === 0}
          className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            borderColor: 'var(--border-faint)',
            color: 'var(--text-secondary)'
          }}
        >
          <FileJson size={16} />
          JSON
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {messages.length === 0 && (
          <div className="text-center mt-16 max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
              RAG Documentation Assistant
            </h1>
            <p className="text-lg mb-2" style={{ color: 'var(--text-secondary)' }}>
              Ask me anything about your documentation.
            </p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              I'll search through your indexed content to provide relevant answers.
            </p>
          </div>
        )}

        <div className="max-w-4xl mx-auto space-y-8">
          {messages.map((message, index) => (
            <div key={message.id} className="space-y-4">
              {message.role === 'user' && (
                <div className="user-query-section">
                  <h2 className="text-xl font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                    Query
                  </h2>
                  <div
                    className="p-4 rounded-lg border"
                    style={{
                      background: 'var(--bg-secondary)',
                      borderColor: 'var(--border-light)',
                      color: 'var(--text-primary)'
                    }}
                  >
                    {message.content}
                  </div>
                </div>
              )}

              {message.role === 'assistant' && (
                <div className="assistant-response-section">
                  <h2 className="text-xl font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                    Answer
                  </h2>
                  <SmartResponse
                    answer={message.content}
                    query={messages[index - 1]?.content || ''}
                    citations={message.citations || []}
                  />
                  <div className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                    Answered at {message.timestamp.toLocaleTimeString()}
                  </div>
                </div>
              )}
            </div>
          ))}

          {streamingPlaceholderVisible && (
            <div className="assistant-response-section">
              <h2 className="text-xl font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                Answer
              </h2>
              <div
                className="p-8 rounded-lg border text-center"
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
          )}
        </div>
        <div ref={messagesEndRef} />
      </div>

      <div
        className="border-t px-8 py-6"
        style={{
          background: 'var(--bg-secondary)',
          borderColor: 'var(--border-faint)'
        }}
      >
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
          <div className="flex space-x-3">
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about your documentation..."
              className="flex-1 input-base"
              disabled={isProcessing}
            />
            <button
              type="submit"
              disabled={!input.trim() || isProcessing}
              className="px-6 py-3 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'var(--accent)',
                color: 'white'
              }}
            >
              <Send size={20} />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
