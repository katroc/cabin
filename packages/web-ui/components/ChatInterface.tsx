'use client'

import { useState } from 'react'
import { Send } from 'lucide-react'
import { SmartResponse } from './SmartResponse'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    const assistantMessageId = (Date.now() + 1).toString()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date()
    }

    setMessages(prev => [...prev, assistantMessage])

    try {
      const response = await fetch('http://localhost:8788/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: input })
      })

      if (!response.ok) throw new Error('Network response was not ok')

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Update the assistant message with the accumulated content
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMessageId
            ? { ...msg, content: buffer }
            : msg
        ))
      }
    } catch (error) {
      console.error('Streaming error:', error)
      setMessages(prev => prev.map(msg =>
        msg.id === assistantMessageId
          ? { ...msg, content: 'Sorry, I encountered an error processing your request.' }
          : msg
      ))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col" style={{background: 'var(--bg-primary)'}}>
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {messages.length === 0 && (
          <div className="text-center mt-16 max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold mb-4" style={{color: 'var(--text-primary)'}}>
              RAG Documentation Assistant
            </h1>
            <p className="text-lg mb-2" style={{color: 'var(--text-secondary)'}}>
              Ask me anything about your documentation.
            </p>
            <p className="text-sm" style={{color: 'var(--text-muted)'}}>
              I'll search through your indexed content to provide relevant answers.
            </p>
          </div>
        )}

        <div className="max-w-4xl mx-auto space-y-8">
          {messages.map((message, index) => (
            <div key={message.id} className="space-y-4">
              {/* User query */}
              {message.role === 'user' && (
                <div className="user-query-section">
                  <h2 className="text-xl font-semibold mb-3" style={{color: 'var(--text-primary)'}}>
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

              {/* Assistant response */}
              {message.role === 'assistant' && (
                <div className="assistant-response-section">
                  <h2 className="text-xl font-semibold mb-3" style={{color: 'var(--text-primary)'}}>
                    Answer
                  </h2>
                  <SmartResponse
                    answer={message.content}
                    query={messages[index - 1]?.content || ''}
                  />
                  <div className="text-xs mt-3" style={{color: 'var(--text-muted)'}}>
                    Answered at {message.timestamp.toLocaleTimeString()}
                  </div>
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="assistant-response-section">
              <h2 className="text-xl font-semibold mb-3" style={{color: 'var(--text-primary)'}}>
                Answer
              </h2>
              <div
                className="p-8 rounded-lg border text-center"
                style={{
                  background: 'var(--bg-secondary)',
                  borderColor: 'var(--border-faint)',
                }}
              >
                <div className="flex justify-center items-center space-x-2">
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{background: 'var(--accent)'}}></div>
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{background: 'var(--accent)', animationDelay: '0.1s'}}></div>
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{background: 'var(--accent)', animationDelay: '0.2s'}}></div>
                </div>
                <p className="mt-3 text-sm" style={{color: 'var(--text-secondary)'}}>
                  Searching documentation and generating response...
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
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
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your documentation..."
              className="flex-1 px-4 py-3 rounded-lg border focus:outline-none focus:ring-2"
              style={{
                background: 'var(--bg-primary)',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
                '--tw-ring-color': 'var(--accent)'
              }}
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
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