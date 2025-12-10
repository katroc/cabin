'use client'

import { memo } from 'react'
import { Copy, RefreshCw, Check } from 'lucide-react'
import SmartResponse from '../SmartResponse'
import type { Citation, RenderedCitation, Message } from '../../app/hooks/useChatStream'

interface MessageBubbleProps {
    message: Message
    previousMessage?: Message
    isHovered: boolean
    isCopied: boolean
    isStreaming: boolean
    canRegenerate: boolean
    onMouseEnter: () => void
    onMouseLeave: () => void
    onCopy: (messageId: string, content: string) => void
    onRegenerate: (messageId: string) => void
}

function formatTimestamp(timestamp: Date): string {
    const now = new Date()
    const msgDate = new Date(timestamp)
    const isToday = now.toDateString() === msgDate.toDateString()
    const isYesterday =
        new Date(now.setDate(now.getDate() - 1)).toDateString() === msgDate.toDateString()

    if (isToday) {
        return msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (isYesterday) {
        return `Yesterday ${msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    } else {
        return (
            msgDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
            ' ' +
            msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        )
    }
}

function MessageBubble({
    message,
    previousMessage,
    isHovered,
    isCopied,
    isStreaming,
    canRegenerate,
    onMouseEnter,
    onMouseLeave,
    onCopy,
    onRegenerate,
}: MessageBubbleProps) {
    const isUser = message.role === 'user'
    const showActions = isHovered || isCopied

    return (
        <div
            className={`flex ${isUser ? 'justify-end' : 'justify-start'} group`}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div className={isUser ? 'max-w-xl space-y-2' : 'w-full space-y-2'}>
                <div
                    className={
                        isUser
                            ? 'px-4 py-3 border rounded-lg ui-border-light ui-bg-secondary'
                            : 'px-4 py-3 rounded-lg ui-bg-tertiary/30 border border-transparent'
                    }
                >
                    {isUser ? (
                        <p className="whitespace-pre-wrap text-base leading-relaxed ui-text-primary">
                            {message.content}
                        </p>
                    ) : (
                        <SmartResponse
                            answer={message.content}
                            query={previousMessage?.content || ''}
                            citations={message.citations || []}
                            renderedCitations={message.rendered_citations || []}
                            thinking={message.thinking || ''}
                            isVerifyingSources={false}
                            isStreaming={isStreaming}
                        />
                    )}
                </div>

                <div
                    className={`flex items-center gap-2 text-xs ui-text-muted relative ${isUser ? 'justify-end' : 'justify-start'
                        }`}
                >
                    <span>{isUser ? 'You' : 'Cabin Assistant'}</span>
                    <span>•</span>
                    <span>{formatTimestamp(message.timestamp)}</span>

                    {/* Message Actions */}
                    {showActions && (
                        <div className={`absolute ${isUser ? 'left-0' : 'right-0'} flex items-center gap-1`}>
                            <button
                                onClick={() => onCopy(message.id, message.content)}
                                className="message-action-button"
                                aria-label="Copy message"
                                title="Copy message"
                            >
                                {isCopied ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                            {canRegenerate && (
                                <button
                                    onClick={() => onRegenerate(message.id)}
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
}

export default memo(MessageBubble)
