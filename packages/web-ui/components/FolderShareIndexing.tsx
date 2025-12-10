'use client'

import { useState, useEffect, useCallback } from 'react'
import { FolderOpen, Plus, Trash2, Play, CheckCircle, AlertCircle, Clock, X, ArrowLeft, RefreshCw, Settings, Server } from 'lucide-react'
import { getApiUrl } from '../lib/config'
import { useToast } from './ToastProvider'

interface FolderShare {
    id: string
    path: string
    name: string
    recursive: boolean
    max_depth: number
    is_smb: boolean
    created_at: string
    last_indexed: string | null
    document_count: number
}

interface ChangeSet {
    added: string[]
    modified: string[]
    deleted: string[]
    total_changes: number
    has_changes: boolean
    scan_time: string
}

interface IndexingJob {
    id: string
    status: 'pending' | 'running' | 'completed' | 'failed'
    progress: number
    totalItems: number
    processedItems: number
    startedAt: Date
    completedAt?: Date
    error?: string
}

interface FolderShareIndexingProps {
    isOpen: boolean
    onClose: () => void
    onBack?: () => void
}

export default function FolderShareIndexing({ isOpen, onClose, onBack }: FolderShareIndexingProps) {
    const [shares, setShares] = useState<FolderShare[]>([])
    const [pathInput, setPathInput] = useState('')
    const [nameInput, setNameInput] = useState('')
    const [isSmb, setIsSmb] = useState(false)
    const [smbUsername, setSmbUsername] = useState('')
    const [smbPassword, setSmbPassword] = useState('')
    const [jobs, setJobs] = useState<IndexingJob[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isIndexing, setIsIndexing] = useState(false)
    const [selectedShare, setSelectedShare] = useState<string | null>(null)
    const [scanResult, setScanResult] = useState<ChangeSet | null>(null)
    const [showAdvanced, setShowAdvanced] = useState(false)

    const { addToast } = useToast()

    // Load shares on mount
    useEffect(() => {
        if (isOpen) {
            loadShares()
        }
    }, [isOpen])

    const loadShares = async () => {
        setIsLoading(true)
        try {
            const response = await fetch(getApiUrl('/api/data-sources/folder-share/list'))
            if (response.ok) {
                const data = await response.json()
                setShares(data.shares || [])
            }
        } catch (error) {
            console.error('Failed to load folder shares:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleAddShare = async () => {
        const trimmedPath = pathInput.trim()
        if (!trimmedPath) return

        try {
            const response = await fetch(getApiUrl('/api/data-sources/folder-share/add'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: trimmedPath,
                    name: nameInput.trim() || undefined,
                    smb_username: isSmb && smbUsername ? smbUsername : undefined,
                    smb_password: isSmb && smbPassword ? smbPassword : undefined,
                })
            })

            if (!response.ok) {
                const error = await response.json()
                addToast(error.detail || 'Failed to add folder share', 'error')
                return
            }

            const data = await response.json()
            addToast(`Added folder share: ${data.share.name}`, 'success')

            // Reload shares
            loadShares()

            // Reset form
            setPathInput('')
            setNameInput('')
            setSmbUsername('')
            setSmbPassword('')
            setIsSmb(false)
        } catch (error) {
            console.error('Failed to add folder share:', error)
            addToast('Failed to add folder share', 'error')
        }
    }

    const handleRemoveShare = async (shareId: string) => {
        try {
            const response = await fetch(getApiUrl(`/api/data-sources/folder-share/${shareId}`), {
                method: 'DELETE'
            })

            if (response.ok) {
                addToast('Folder share removed', 'success')
                loadShares()
            }
        } catch (error) {
            console.error('Failed to remove folder share:', error)
            addToast('Failed to remove folder share', 'error')
        }
    }

    const handleScanChanges = async (shareId: string) => {
        setSelectedShare(shareId)
        setScanResult(null)

        try {
            const response = await fetch(getApiUrl(`/api/data-sources/folder-share/${shareId}/scan`), {
                method: 'POST'
            })

            if (response.ok) {
                const data = await response.json()
                setScanResult(data.changes)
            }
        } catch (error) {
            console.error('Failed to scan for changes:', error)
            addToast('Failed to scan for changes', 'error')
        }
    }

    const handleStartIndexing = async (shareId: string) => {
        setIsIndexing(true)
        setSelectedShare(shareId)

        try {
            const response = await fetch(getApiUrl(`/api/data-sources/folder-share/${shareId}/index`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ max_items: 1000 })
            })

            if (!response.ok) {
                throw new Error('Failed to start indexing')
            }

            const { job_id } = await response.json()

            const newJob: IndexingJob = {
                id: job_id,
                status: 'running',
                progress: 0,
                totalItems: 0,
                processedItems: 0,
                startedAt: new Date()
            }

            setJobs(prev => [newJob, ...prev])

            // Poll for progress
            const pollInterval = setInterval(async () => {
                try {
                    const progressResponse = await fetch(getApiUrl(`/api/data-sources/jobs/${job_id}`))

                    if (!progressResponse.ok) {
                        clearInterval(pollInterval)
                        return
                    }

                    const progressData = await progressResponse.json()

                    setJobs(prev => prev.map(job =>
                        job.id === job_id
                            ? {
                                ...job,
                                status: progressData.status,
                                progress: progressData.total_items > 0
                                    ? (progressData.processed_items / progressData.total_items) * 100
                                    : 0,
                                totalItems: progressData.total_items || 0,
                                processedItems: progressData.processed_items || 0,
                                completedAt: progressData.status === 'completed' || progressData.status === 'failed'
                                    ? new Date()
                                    : undefined,
                                error: progressData.error_message
                            }
                            : job
                    ))

                    if (progressData.status === 'completed' || progressData.status === 'failed') {
                        clearInterval(pollInterval)
                        setIsIndexing(false)
                        loadShares() // Refresh to get updated document count

                        if (progressData.status === 'completed') {
                            addToast(`Indexed ${progressData.processed_items} documents`, 'success')
                        }
                    }
                } catch (error) {
                    console.error('Error polling progress:', error)
                    clearInterval(pollInterval)
                    setIsIndexing(false)
                }
            }, 1000)

        } catch (error) {
            console.error('Failed to start indexing:', error)
            setIsIndexing(false)
            addToast('Failed to start indexing', 'error')
        }
    }

    const detectSmbPath = useCallback((path: string) => {
        setIsSmb(path.startsWith('smb://') || path.startsWith('//'))
    }, [])

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="relative flex h-[90vh] w-full max-w-4xl flex-col rounded-xl border ui-bg-primary ui-border-light ui-shadow-elevated">
                {/* Header */}
                <div className="flex items-center justify-between border-b px-6 py-4 ui-border-light">
                    <div className="flex items-center gap-3">
                        {onBack && (
                            <button onClick={onBack} className="btn-icon" aria-label="Back">
                                <ArrowLeft className="w-5 h-5" />
                            </button>
                        )}
                        <div className="flex items-center gap-3">
                            <FolderOpen className="w-5 h-5 ui-text-secondary" />
                            <span className="font-medium ui-text-primary">Folder / Share</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="btn-close">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {/* Add Folder/Share */}
                    <div className="mb-6">
                        <label className="mb-2 block text-sm font-medium ui-text-secondary">
                            Add Folder or Network Share
                        </label>
                        <div className="flex gap-2 mb-2">
                            <input
                                type="text"
                                value={pathInput}
                                onChange={(e) => {
                                    setPathInput(e.target.value)
                                    detectSmbPath(e.target.value)
                                }}
                                placeholder="/path/to/folder or smb://server/share"
                                className="flex-1 rounded-lg border px-4 py-2 text-base ui-bg-secondary ui-border-light ui-text-primary focus:border-[var(--accent)] focus:outline-none"
                                disabled={isIndexing}
                            />
                            <button
                                onClick={() => setShowAdvanced(!showAdvanced)}
                                className="btn-icon"
                                title="Advanced options"
                            >
                                <Settings size={18} />
                            </button>
                            <button
                                onClick={handleAddShare}
                                disabled={!pathInput.trim() || isIndexing}
                                className="btn-secondary flex items-center gap-2"
                            >
                                <Plus size={16} />
                                Add
                            </button>
                        </div>

                        {/* Advanced options */}
                        {showAdvanced && (
                            <div className="mt-3 p-4 rounded-lg border ui-bg-secondary ui-border-light space-y-3">
                                <div>
                                    <label className="block text-xs font-medium ui-text-secondary mb-1">
                                        Display Name (optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={nameInput}
                                        onChange={(e) => setNameInput(e.target.value)}
                                        placeholder="My Documents"
                                        className="w-full rounded-lg border px-3 py-1.5 text-sm ui-bg-primary ui-border-light ui-text-primary focus:border-[var(--accent)] focus:outline-none"
                                    />
                                </div>

                                {isSmb && (
                                    <>
                                        <div className="flex items-center gap-2 text-xs ui-text-muted">
                                            <Server size={14} />
                                            SMB/CIFS share detected
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs font-medium ui-text-secondary mb-1">
                                                    Username (optional)
                                                </label>
                                                <input
                                                    type="text"
                                                    value={smbUsername}
                                                    onChange={(e) => setSmbUsername(e.target.value)}
                                                    placeholder="domain\\username"
                                                    className="w-full rounded-lg border px-3 py-1.5 text-sm ui-bg-primary ui-border-light ui-text-primary focus:border-[var(--accent)] focus:outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium ui-text-secondary mb-1">
                                                    Password (optional)
                                                </label>
                                                <input
                                                    type="password"
                                                    value={smbPassword}
                                                    onChange={(e) => setSmbPassword(e.target.value)}
                                                    placeholder="••••••••"
                                                    className="w-full rounded-lg border px-3 py-1.5 text-sm ui-bg-primary ui-border-light ui-text-primary focus:border-[var(--accent)] focus:outline-none"
                                                />
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        <p className="mt-2 text-xs ui-text-muted">
                            Add local folders or SMB network shares (smb://server/share or //server/share)
                        </p>
                    </div>

                    {/* Shares List */}
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <RefreshCw className="w-6 h-6 animate-spin ui-text-muted" />
                        </div>
                    ) : shares.length > 0 ? (
                        <div className="mb-6">
                            <h3 className="mb-3 text-sm font-medium ui-text-secondary">
                                Configured Shares ({shares.length})
                            </h3>
                            <div className="space-y-3">
                                {shares.map((share) => (
                                    <div
                                        key={share.id}
                                        className="rounded-lg border p-4 ui-bg-secondary ui-border-light"
                                    >
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                {share.is_smb ? (
                                                    <Server className="w-4 h-4 ui-text-muted" />
                                                ) : (
                                                    <FolderOpen className="w-4 h-4 ui-text-muted" />
                                                )}
                                                <span className="font-medium ui-text-primary">{share.name}</span>
                                                {share.is_smb && (
                                                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                                                        SMB
                                                    </span>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => handleRemoveShare(share.id)}
                                                disabled={isIndexing}
                                                className="btn-icon text-red-400 hover:text-red-300"
                                                aria-label="Remove share"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>

                                        <p className="text-xs ui-text-muted mb-3 font-mono truncate" title={share.path}>
                                            {share.path}
                                        </p>

                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4 text-xs ui-text-muted">
                                                <span>
                                                    {share.document_count} documents
                                                </span>
                                                {share.last_indexed && (
                                                    <span>
                                                        Last indexed: {new Date(share.last_indexed).toLocaleString()}
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleScanChanges(share.id)}
                                                    disabled={isIndexing}
                                                    className="btn-secondary text-xs py-1 px-2"
                                                >
                                                    <RefreshCw size={14} className="mr-1" />
                                                    Scan
                                                </button>
                                                <button
                                                    onClick={() => handleStartIndexing(share.id)}
                                                    disabled={isIndexing}
                                                    className="btn-primary text-xs py-1 px-2"
                                                >
                                                    <Play size={14} className="mr-1" />
                                                    Index
                                                </button>
                                            </div>
                                        </div>

                                        {/* Scan results */}
                                        {selectedShare === share.id && scanResult && (
                                            <div className="mt-3 p-3 rounded-lg ui-bg-tertiary text-xs">
                                                {scanResult.has_changes ? (
                                                    <div className="space-y-1">
                                                        <p className="font-medium ui-text-primary">
                                                            {scanResult.total_changes} changes detected:
                                                        </p>
                                                        {scanResult.added.length > 0 && (
                                                            <p className="text-green-400">+ {scanResult.added.length} new files</p>
                                                        )}
                                                        {scanResult.modified.length > 0 && (
                                                            <p className="text-yellow-400">~ {scanResult.modified.length} modified</p>
                                                        )}
                                                        {scanResult.deleted.length > 0 && (
                                                            <p className="text-red-400">- {scanResult.deleted.length} deleted</p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <p className="ui-text-muted">No changes detected</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-8 ui-text-muted">
                            <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
                            <p>No folder shares configured</p>
                            <p className="text-xs mt-1">Add a folder path above to get started</p>
                        </div>
                    )}

                    {/* Jobs History */}
                    {jobs.length > 0 && (
                        <div className="mt-6">
                            <h3 className="mb-3 text-sm font-medium ui-text-secondary">Indexing History</h3>
                            <div className="space-y-3">
                                {jobs.map((job) => (
                                    <div
                                        key={job.id}
                                        className="rounded-lg border p-4 ui-bg-secondary ui-border-light"
                                    >
                                        <div className="mb-2 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                {job.status === 'running' && (
                                                    <Clock className="animate-spin text-blue-500" size={16} />
                                                )}
                                                {job.status === 'completed' && (
                                                    <CheckCircle className="text-green-500" size={16} />
                                                )}
                                                {job.status === 'failed' && (
                                                    <AlertCircle className="text-red-500" size={16} />
                                                )}
                                                <span className="text-sm font-medium capitalize ui-text-primary">
                                                    {job.status}
                                                </span>
                                            </div>
                                            <span className="text-xs ui-text-muted">
                                                {job.startedAt.toLocaleTimeString()}
                                            </span>
                                        </div>

                                        {job.status === 'running' && (
                                            <div className="mb-2">
                                                <div className="h-2 overflow-hidden rounded-full ui-bg-tertiary">
                                                    <div
                                                        className="h-full bg-[var(--accent)] transition-all duration-300"
                                                        style={{ width: `${job.progress}%` }}
                                                    />
                                                </div>
                                                <p className="mt-1 text-xs ui-text-muted">
                                                    {job.processedItems} of {job.totalItems} files processed
                                                </p>
                                            </div>
                                        )}

                                        {job.status === 'completed' && (
                                            <p className="text-xs text-green-600">
                                                Successfully indexed {job.processedItems} files
                                            </p>
                                        )}

                                        {job.error && (
                                            <p className="text-xs text-red-500">{job.error}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
