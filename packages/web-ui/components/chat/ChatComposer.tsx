'use client'

import { useRef, useEffect, forwardRef } from 'react'
import { Send, StopCircle } from 'lucide-react'
import PersonaSelector from '../PersonaSelector'
import type { ChatMode, PersonaType } from '../contexts/UIPreferencesProvider'

interface ChatComposerProps {
    input: string
    chatMode: ChatMode
    persona: PersonaType
    isProcessing: boolean
    canStop: boolean
    conversationId?: string
    onInputChange: (value: string) => void
    onSubmit: () => void
    onStop: () => void
    onChatModeChange: (mode: ChatMode) => void
    onPersonaChange: (persona: PersonaType) => void
}

const ChatComposer = forwardRef<HTMLTextAreaElement, ChatComposerProps>(
    (
        {
            input,
            chatMode,
            persona,
            isProcessing,
            canStop,
            conversationId,
            onInputChange,
            onSubmit,
            onStop,
            onChatModeChange,
            onPersonaChange,
        },
        ref
    ) => {
        const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                onSubmit()
            } else if (event.key === 'Tab') {
                event.preventDefault()
                onChatModeChange(chatMode === 'rag' ? 'llm' : 'rag')
            } else if (event.key === 'Escape') {
                event.preventDefault()
                onInputChange('')
                if (conversationId) {
                    localStorage.removeItem(`draft-${conversationId}`)
                }
            }
        }

        const handleSubmit = (event: React.FormEvent) => {
            event.preventDefault()
            onSubmit()
        }

        return (
            <footer
                className="px-4 pb-4 sm:pl-10 sm:pr-[calc(2.5rem+8px)] md:pl-10 md:pr-[calc(2.5rem+8px)] pt-0 bg-transparent"
                style={{
                    paddingBottom: 'max(1rem, calc(1rem + env(safe-area-inset-bottom, 0)))',
                }}
            >
                <form onSubmit={handleSubmit} className="mx-auto w-full max-w-[min(65vw,62rem)]">
                    <div className="w-full rounded-2xl border px-4 py-2.5 sm:px-5 ui-bg-secondary ui-border-light ui-shadow-elevated">
                        <textarea
                            ref={ref}
                            rows={1}
                            value={input}
                            onChange={(event) => {
                                onInputChange(event.target.value)
                                // Auto-resize textarea
                                const target = event.target
                                target.style.height = 'auto'
                                target.style.height = `${Math.min(target.scrollHeight, 200)}px`
                            }}
                            onKeyDown={handleKeyDown}
                            placeholder={
                                chatMode === 'rag' ? 'Ask about your documentation...' : 'Chat with AI...'
                            }
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
                                <PersonaSelector value={persona} onChange={onPersonaChange} />
                                {canStop && (
                                    <button
                                        type="button"
                                        onClick={onStop}
                                        className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition ui-bg-secondary ui-border-light ui-text-secondary"
                                    >
                                        <StopCircle size={14} />
                                        Stop
                                    </button>
                                )}

                                {/* RAG/LLM Toggle */}
                                <div
                                    className="relative flex items-center bg-[var(--bg-tertiary)] rounded-full border ui-border-light p-0.5 cursor-pointer"
                                    onClick={() => onChatModeChange(chatMode === 'rag' ? 'llm' : 'rag')}
                                >
                                    <div
                                        className={`absolute top-0.5 bottom-0.5 rounded-full transition-all duration-200 ease-in-out ${chatMode === 'rag'
                                            ? 'left-0.5 right-1/2 bg-[var(--accent)]'
                                            : 'left-1/2 right-0.5 bg-orange-500'
                                            }`}
                                    />
                                    <div
                                        className={`relative z-10 px-2.5 py-1 text-xs font-medium rounded-full transition-colors duration-200 ${chatMode === 'rag'
                                            ? 'text-white'
                                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                                            }`}
                                    >
                                        RAG
                                    </div>
                                    <div
                                        className={`relative z-10 px-2.5 py-1 text-xs font-medium rounded-full transition-colors duration-200 ${chatMode === 'llm'
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
                                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200 disabled:opacity-50 text-white ui-shadow-elevated ${chatMode === 'rag'
                                        ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] border-[var(--accent)]'
                                        : 'bg-orange-500 hover:bg-orange-600 border-orange-500'
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
        )
    }
)

ChatComposer.displayName = 'ChatComposer'

export default ChatComposer
