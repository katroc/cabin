'use client'

import { useCallback, useRef, useState } from 'react'
import { splitThinking, deriveAnswerFromThinking } from '../../utils/thinking'

// Types
export interface Citation {
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

export interface RenderedCitation {
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

export interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    thinking?: string
    citations?: Citation[]
    rendered_citations?: RenderedCitation[]
    timestamp: Date
}

export type ChatMode = 'rag' | 'llm'
export type PersonaType = 'assistant' | 'expert' | 'tutor' | 'analyst'

// API endpoints
const ENDPOINTS = {
    rag: {
        standard: 'http://localhost:8788/api/chat',
        stream: 'http://localhost:8788/api/chat/stream',
    },
    llm: {
        standard: 'http://localhost:8788/api/chat/direct',
        stream: 'http://localhost:8788/api/chat/direct/stream',
    },
}

interface UseChatStreamOptions {
    conversationId: string | undefined
    chatMode: ChatMode
    persona: PersonaType
    onUpdateMessage: (assistantId: string, updater: (message: Message) => Message) => void
}

interface UseChatStreamReturn {
    isProcessing: boolean
    streamingMessageId: string | null
    abortController: AbortController | null
    streamResponse: (prompt: string, assistantId: string) => Promise<string>
    requestFullResponse: (prompt: string) => Promise<any>
    stopGeneration: () => void
    setIsProcessing: (value: boolean) => void
    setStreamingMessageId: (value: string | null) => void
}

export function useChatStream({
    conversationId,
    chatMode,
    persona,
    onUpdateMessage,
}: UseChatStreamOptions): UseChatStreamReturn {
    const [isProcessing, setIsProcessing] = useState(false)
    const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
    const abortControllerRef = useRef<AbortController | null>(null)

    const streamResponse = useCallback(
        async (prompt: string, assistantId: string): Promise<string> => {
            const controller = new AbortController()
            abortControllerRef.current = controller
            setStreamingMessageId(assistantId)

            const endpoint = ENDPOINTS[chatMode].stream
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: prompt,
                    conversation_id: conversationId,
                    persona: persona,
                }),
                signal: controller.signal,
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
            let citations: Citation[] = []
            let renderedCitations: RenderedCitation[] = []
            let lastUpdate = 0

            while (true) {
                const { value, done } = await reader.read()
                if (done) break

                const chunk = decoder.decode(value, { stream: true })
                let cleanChunk = chunk

                // Parse metadata from stream
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
                            onUpdateMessage(assistantId, (message) => ({
                                ...message,
                                citations,
                                rendered_citations: renderedCitations,
                                thinking: thinkingContent || message.thinking,
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

                // Throttle updates
                const now = Date.now()
                if (now - lastUpdate > 50) {
                    onUpdateMessage(assistantId, (message) => ({
                        ...message,
                        content: visibleResponse,
                        thinking: thinkingContent || message.thinking,
                        citations: message.citations?.length ? message.citations : citations,
                        rendered_citations: message.rendered_citations?.length
                            ? message.rendered_citations
                            : renderedCitations,
                    }))
                    lastUpdate = now
                    await new Promise((resolve) => setTimeout(resolve, 8))
                }
            }

            // Final update
            onUpdateMessage(assistantId, (message) => ({
                ...message,
                content: visibleResponse,
                thinking: thinkingContent || message.thinking,
                citations: message.citations?.length ? message.citations : citations,
                rendered_citations: message.rendered_citations?.length
                    ? message.rendered_citations
                    : renderedCitations,
            }))

            setStreamingMessageId(null)
            abortControllerRef.current = null
            return visibleResponse
        },
        [chatMode, conversationId, persona, onUpdateMessage]
    )

    const requestFullResponse = useCallback(
        async (prompt: string) => {
            const endpoint = ENDPOINTS[chatMode].standard
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: prompt,
                    conversation_id: conversationId,
                    persona: persona,
                }),
            })

            if (!response.ok) {
                throw new Error('Network response was not ok')
            }

            return response.json()
        },
        [chatMode, conversationId, persona]
    )

    const stopGeneration = useCallback(() => {
        abortControllerRef.current?.abort()
        abortControllerRef.current = null
        setIsProcessing(false)
        setStreamingMessageId(null)
    }, [])

    return {
        isProcessing,
        streamingMessageId,
        abortController: abortControllerRef.current,
        streamResponse,
        requestFullResponse,
        stopGeneration,
        setIsProcessing,
        setStreamingMessageId,
    }
}
