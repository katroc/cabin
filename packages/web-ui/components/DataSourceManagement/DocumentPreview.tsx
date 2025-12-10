'use client'

import { X, ExternalLink, FileText, Layers, Globe, Upload, Link as LinkIcon, Copy, Check, Calendar, Tag, Info } from 'lucide-react'
import { IndexedDocument } from './types'
import { useState } from 'react'

interface DocumentPreviewProps {
    document: IndexedDocument | null
    isOpen: boolean
    onClose: () => void
}

export default function DocumentPreview({ document, isOpen, onClose }: DocumentPreviewProps) {
    const [copied, setCopied] = useState(false)

    const getSourceIcon = (sourceType: string) => {
        switch (sourceType) {
            case 'file_upload': return <Upload className="w-5 h-5" />
            case 'confluence': return <Globe className="w-5 h-5" />
            case 'url_ingestion': return <LinkIcon className="w-5 h-5" />
            default: return <FileText className="w-5 h-5" />
        }
    }

    const getSourceLabel = (sourceType: string) => {
        switch (sourceType) {
            case 'file_upload': return 'File Upload'
            case 'confluence': return 'Confluence'
            case 'url_ingestion': return 'URL'
            default: return sourceType.replace('_', ' ')
        }
    }

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'Unknown'
        return new Date(dateString).toLocaleString()
    }

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    if (!isOpen || !document) return null

    const sourceUrl = (document as any).source_url
    const spaceName = (document as any).space_name
    const spaceKey = (document as any).space_key

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Panel */}
            <div className="relative w-full max-w-md h-full ui-bg-primary border-l ui-border-light flex flex-col shadow-2xl">
                {/* Header */}
                <div className="flex items-start justify-between p-6 border-b ui-border-light">
                    <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 mb-2 text-[var(--accent)]">
                            {getSourceIcon(document.source_type)}
                            <span className="text-sm font-medium">{getSourceLabel(document.source_type)}</span>
                        </div>
                        <h2 className="text-lg font-semibold ui-text-primary" title={document.title}>
                            {document.title}
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:ui-bg-tertiary rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">

                    {/* Source Link - Primary Action */}
                    {sourceUrl && (
                        <div className="p-4 ui-bg-secondary border ui-border-faint rounded-lg">
                            <a
                                href={sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-3 w-full py-3 px-4 bg-[var(--accent)] hover:opacity-90 text-white rounded-lg font-medium transition-all"
                            >
                                <ExternalLink className="w-5 h-5" />
                                Open Original Source
                            </a>
                            <div className="mt-3 flex items-center gap-2">
                                <input
                                    type="text"
                                    value={sourceUrl}
                                    readOnly
                                    className="flex-1 text-xs ui-text-muted bg-transparent border-none outline-none truncate"
                                />
                                <button
                                    onClick={() => copyToClipboard(sourceUrl)}
                                    className="p-1.5 hover:ui-bg-tertiary rounded transition-colors"
                                    title="Copy URL"
                                >
                                    {copied ? (
                                        <Check className="w-4 h-4 text-[var(--success)]" />
                                    ) : (
                                        <Copy className="w-4 h-4 ui-text-muted" />
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Document Metadata */}
                    <div className="space-y-4">
                        <h3 className="text-sm font-medium ui-text-secondary flex items-center gap-2">
                            <Info className="w-4 h-4" />
                            Document Details
                        </h3>

                        <div className="grid grid-cols-2 gap-4">
                            {/* Status */}
                            <div className="p-3 ui-bg-secondary rounded-lg">
                                <div className="text-xs ui-text-muted mb-1">Status</div>
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${document.status === 'indexed' ? 'bg-[var(--success)]' :
                                            document.status === 'error' ? 'bg-[var(--error)]' :
                                                document.status === 'processing' ? 'bg-[var(--accent)] animate-pulse' :
                                                    'bg-[var(--warning)]'
                                        }`} />
                                    <span className="text-sm ui-text-primary capitalize">{document.status}</span>
                                </div>
                            </div>

                            {/* Chunks */}
                            <div className="p-3 ui-bg-secondary rounded-lg">
                                <div className="text-xs ui-text-muted mb-1">Indexed Chunks</div>
                                <div className="flex items-center gap-2">
                                    <Layers className="w-4 h-4 ui-text-muted" />
                                    <span className="text-sm ui-text-primary font-medium">{document.chunk_count || 0}</span>
                                </div>
                            </div>

                            {/* Last Modified */}
                            <div className="p-3 ui-bg-secondary rounded-lg col-span-2">
                                <div className="text-xs ui-text-muted mb-1">Last Modified</div>
                                <div className="flex items-center gap-2">
                                    <Calendar className="w-4 h-4 ui-text-muted" />
                                    <span className="text-sm ui-text-primary">{formatDate(document.last_modified)}</span>
                                </div>
                            </div>

                            {/* Space (for Confluence) */}
                            {spaceName && (
                                <div className="p-3 ui-bg-secondary rounded-lg col-span-2">
                                    <div className="text-xs ui-text-muted mb-1">Confluence Space</div>
                                    <div className="flex items-center gap-2">
                                        <Globe className="w-4 h-4 ui-text-muted" />
                                        <span className="text-sm ui-text-primary">{spaceName}</span>
                                        {spaceKey && <span className="text-xs ui-text-muted">({spaceKey})</span>}
                                    </div>
                                </div>
                            )}

                            {/* Content Type */}
                            {document.content_type && (
                                <div className="p-3 ui-bg-secondary rounded-lg col-span-2">
                                    <div className="text-xs ui-text-muted mb-1">Content Type</div>
                                    <span className="text-sm ui-text-primary">{document.content_type}</span>
                                </div>
                            )}

                            {/* Tags */}
                            {document.tags && document.tags.length > 0 && (
                                <div className="p-3 ui-bg-secondary rounded-lg col-span-2">
                                    <div className="text-xs ui-text-muted mb-2">Tags</div>
                                    <div className="flex flex-wrap gap-2">
                                        {document.tags.map((tag, i) => (
                                            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 text-xs ui-bg-tertiary rounded-full">
                                                <Tag className="w-3 h-3" />
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Document ID */}
                    <div className="pt-4 border-t ui-border-faint">
                        <div className="text-xs ui-text-muted mb-1">Document ID</div>
                        <code className="text-xs ui-text-secondary break-all">{document.id}</code>
                    </div>
                </div>
            </div>
        </div>
    )
}
