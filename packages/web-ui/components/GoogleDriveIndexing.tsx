'use client'

import { useState, useEffect } from 'react'
import { HardDrive, Play, RefreshCw, CheckCircle, AlertCircle, Clock, ArrowLeft, X, FolderOpen, ExternalLink } from 'lucide-react'
import AlertModal from './AlertModal'
import { useToast } from './ToastProvider'

interface GoogleDriveConfig {
    clientId: string
    clientSecret: string
    redirectUri: string
    accessToken?: string
    refreshToken?: string
    selectedFolders: string[]
    maxItems: number
    includeShared: boolean
}

interface DriveFolder {
    id: string
    name: string
    type: 'folder' | 'shared_drive'
    description: string
}

interface IndexingJob {
    id: string
    status: 'pending' | 'running' | 'completed' | 'failed'
    progress: number
    totalItems: number
    indexedItems: number
    startedAt: Date
    completedAt?: Date
    error?: string
}

interface GoogleDriveIndexingProps {
    isOpen: boolean
    onClose: () => void
    onBack?: () => void
}

export default function GoogleDriveIndexing({ isOpen, onClose, onBack }: GoogleDriveIndexingProps) {
    const { addToast } = useToast()

    const [config, setConfig] = useState<GoogleDriveConfig>({
        clientId: '',
        clientSecret: '',
        redirectUri: typeof window !== 'undefined' ? `${window.location.origin}/auth/google/callback` : '',
        selectedFolders: [],
        maxItems: 1000,
        includeShared: true
    })

    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [isAuthenticating, setIsAuthenticating] = useState(false)
    const [folders, setFolders] = useState<DriveFolder[]>([])
    const [isLoadingFolders, setIsLoadingFolders] = useState(false)
    const [jobs, setJobs] = useState<IndexingJob[]>([])
    const [isIndexing, setIsIndexing] = useState(false)
    const [showAlert, setShowAlert] = useState(false)
    const [alertConfig, setAlertConfig] = useState<{ title: string; message: string; type: 'success' | 'error' | 'info' } | null>(null)

    if (!isOpen) return null

    const handleAuthenticate = async () => {
        if (!config.clientId || !config.clientSecret) {
            setAlertConfig({
                title: 'Missing Credentials',
                message: 'Please provide your Google OAuth2 Client ID and Client Secret.',
                type: 'info'
            })
            setShowAlert(true)
            return
        }

        setIsAuthenticating(true)

        // Open Google OAuth consent screen
        const scopes = encodeURIComponent('https://www.googleapis.com/auth/drive.readonly')
        const redirectUri = encodeURIComponent(config.redirectUri)
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${config.clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scopes}&access_type=offline&prompt=consent`

        // Open popup for OAuth
        const popup = window.open(authUrl, 'Google OAuth', 'width=500,height=600')

        // Listen for the callback
        const checkClosed = setInterval(() => {
            if (popup?.closed) {
                clearInterval(checkClosed)
                setIsAuthenticating(false)
            }
        }, 1000)

        // For demo purposes, simulate authentication
        // In production, you'd handle the OAuth callback and exchange the code for tokens
        setTimeout(() => {
            setIsAuthenticating(false)
            addToast('Please complete the OAuth flow in the popup window', 'info')
        }, 2000)
    }

    const handleTestConnection = async () => {
        if (!config.accessToken && !config.refreshToken) {
            setAlertConfig({
                title: 'Not Authenticated',
                message: 'Please connect with Google first.',
                type: 'info'
            })
            setShowAlert(true)
            return
        }

        setIsLoadingFolders(true)

        try {
            const response = await fetch('http://localhost:8788/api/data-sources/discover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_type: 'google_drive',
                    connection: {
                        additional_config: {
                            client_id: config.clientId,
                            client_secret: config.clientSecret,
                            refresh_token: config.refreshToken,
                            access_token: config.accessToken
                        }
                    }
                })
            })

            if (response.ok) {
                const data = await response.json()
                setFolders(data.sources || [])
                setIsAuthenticated(true)
                addToast('Connected to Google Drive!', 'success')
            } else {
                throw new Error('Failed to connect')
            }
        } catch (error) {
            console.error('Connection test failed:', error)
            setAlertConfig({
                title: 'Connection Failed',
                message: 'Could not connect to Google Drive. Please check your credentials.',
                type: 'error'
            })
            setShowAlert(true)
        } finally {
            setIsLoadingFolders(false)
        }
    }

    const handleFolderToggle = (folderId: string) => {
        setConfig(prev => ({
            ...prev,
            selectedFolders: prev.selectedFolders.includes(folderId)
                ? prev.selectedFolders.filter(id => id !== folderId)
                : [...prev.selectedFolders, folderId]
        }))
    }

    const handleStartIndexing = async () => {
        if (config.selectedFolders.length === 0) {
            setAlertConfig({
                title: 'No Folders Selected',
                message: 'Please select at least one folder to index.',
                type: 'info'
            })
            setShowAlert(true)
            return
        }

        setIsIndexing(true)

        try {
            const response = await fetch('http://localhost:8788/api/data-sources/index', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_type: 'google_drive',
                    connection: {
                        additional_config: {
                            client_id: config.clientId,
                            client_secret: config.clientSecret,
                            refresh_token: config.refreshToken,
                            access_token: config.accessToken
                        }
                    },
                    source_ids: config.selectedFolders,
                    config: {
                        max_items: config.maxItems,
                        include_shared: config.includeShared
                    }
                })
            })

            if (!response.ok) {
                throw new Error('Failed to start indexing')
            }

            const data = await response.json()
            const jobId = data.job_id

            const newJob: IndexingJob = {
                id: jobId,
                status: 'running',
                progress: 0,
                totalItems: 0,
                indexedItems: 0,
                startedAt: new Date()
            }

            setJobs(prev => [newJob, ...prev])
            addToast('Indexing started!', 'success')

            // Poll for progress
            const pollProgress = async () => {
                try {
                    const progressResponse = await fetch(`http://localhost:8788/api/data-sources/jobs/${jobId}`)

                    if (progressResponse.ok) {
                        const progressData = await progressResponse.json()

                        setJobs(prev => prev.map(job =>
                            job.id === jobId
                                ? {
                                    ...job,
                                    status: progressData.status,
                                    progress: progressData.total_items > 0
                                        ? Math.floor((progressData.processed_items / progressData.total_items) * 100)
                                        : progressData.processed_items > 0 ? 50 : 0,
                                    totalItems: progressData.total_items,
                                    indexedItems: progressData.processed_items,
                                    error: progressData.error_message,
                                    completedAt: progressData.completed_at ? new Date(progressData.completed_at) : undefined
                                }
                                : job
                        ))

                        if (progressData.status === 'running' || progressData.status === 'pending') {
                            setTimeout(pollProgress, 2000)
                        } else {
                            setIsIndexing(false)
                            if (progressData.status === 'completed') {
                                addToast(`Indexed ${progressData.processed_items} documents!`, 'success')
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error polling progress:', error)
                    setIsIndexing(false)
                }
            }

            setTimeout(pollProgress, 1000)

        } catch (error) {
            console.error('Error starting indexing:', error)
            setAlertConfig({
                title: 'Indexing Failed',
                message: 'Failed to start indexing. Please try again.',
                type: 'error'
            })
            setShowAlert(true)
            setIsIndexing(false)
        }
    }

    const getStatusIcon = (status: IndexingJob['status']) => {
        switch (status) {
            case 'running':
                return <RefreshCw size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />
            case 'completed':
                return <CheckCircle size={16} style={{ color: 'var(--success)' }} />
            case 'failed':
                return <AlertCircle size={16} style={{ color: 'var(--error)' }} />
            default:
                return <Clock size={16} style={{ color: 'var(--text-muted)' }} />
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex">
            <div className="drawer-overlay" onClick={onClose} />
            <div className="drawer-panel fixed left-0 top-0 h-full w-full max-w-2xl overflow-y-auto">
                {/* Header */}
                <div className="drawer-header ui-bg-secondary border-b ui-border-faint">
                    <div className="flex items-center gap-3">
                        {onBack && (
                            <button onClick={onBack} className="btn-close">
                                <ArrowLeft className="w-4 h-4" />
                            </button>
                        )}
                        <h2 className="drawer-title ui-text-primary">
                            <HardDrive size={20} />
                            Google Drive Indexing
                        </h2>
                    </div>
                    <button onClick={onClose} className="btn-close">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-6 space-y-6 divide-y divide-[color:var(--border-faint)]">
                    {/* OAuth Configuration */}
                    <div className="form-section pt-6 first:pt-0">
                        <h3 className="form-section-title ui-text-secondary text-sm uppercase tracking-wide">
                            Google OAuth2 Setup
                        </h3>

                        <div className="space-y-4">
                            <div className="form-group">
                                <label className="label-base">Client ID</label>
                                <input
                                    type="text"
                                    value={config.clientId}
                                    onChange={(e) => setConfig(prev => ({ ...prev, clientId: e.target.value }))}
                                    placeholder="Your Google OAuth Client ID"
                                    className="input-base"
                                />
                            </div>

                            <div className="form-group">
                                <label className="label-base">Client Secret</label>
                                <input
                                    type="password"
                                    value={config.clientSecret}
                                    onChange={(e) => setConfig(prev => ({ ...prev, clientSecret: e.target.value }))}
                                    placeholder="Your Google OAuth Client Secret"
                                    className="input-base"
                                />
                            </div>

                            <div className="text-sm p-3 rounded-lg" style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border)'
                            }}>
                                <div className="flex items-center gap-2 mb-2 font-medium">
                                    <ExternalLink size={14} />
                                    How to get credentials
                                </div>
                                <ol className="list-decimal list-inside space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                                    <li>Go to Google Cloud Console → APIs & Services → Credentials</li>
                                    <li>Create OAuth 2.0 Client ID (Web application)</li>
                                    <li>Add <code className="px-1 rounded bg-black/10">{config.redirectUri}</code> as authorized redirect URI</li>
                                    <li>Enable Google Drive API in your project</li>
                                </ol>
                            </div>

                            {!isAuthenticated ? (
                                <button
                                    onClick={handleAuthenticate}
                                    disabled={isAuthenticating || !config.clientId || !config.clientSecret}
                                    className="btn-primary flex items-center gap-2"
                                >
                                    {isAuthenticating ? (
                                        <RefreshCw size={16} className="animate-spin" />
                                    ) : (
                                        <HardDrive size={16} />
                                    )}
                                    {isAuthenticating ? 'Connecting...' : 'Connect with Google'}
                                </button>
                            ) : (
                                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--success)' }}>
                                    <CheckCircle size={16} />
                                    Connected to Google Drive
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Folder Selection */}
                    {isAuthenticated && (
                        <div className="form-section pt-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="form-section-title ui-text-secondary text-sm uppercase tracking-wide">
                                    Select Folders to Index
                                </h3>
                                <button
                                    onClick={handleTestConnection}
                                    disabled={isLoadingFolders}
                                    className="btn-secondary text-xs flex items-center gap-1"
                                >
                                    <RefreshCw size={12} className={isLoadingFolders ? 'animate-spin' : ''} />
                                    Refresh
                                </button>
                            </div>

                            {folders.length > 0 ? (
                                <div className="space-y-2 max-h-60 overflow-y-auto">
                                    {folders.map(folder => (
                                        <label
                                            key={folder.id}
                                            className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                                            style={{
                                                background: config.selectedFolders.includes(folder.id)
                                                    ? 'var(--accent-muted)'
                                                    : 'var(--bg-tertiary)',
                                                border: `1px solid ${config.selectedFolders.includes(folder.id) ? 'var(--accent)' : 'var(--border)'}`
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={config.selectedFolders.includes(folder.id)}
                                                onChange={() => handleFolderToggle(folder.id)}
                                                className="rounded"
                                            />
                                            <FolderOpen size={18} style={{ color: 'var(--accent)' }} />
                                            <div className="flex-1">
                                                <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {folder.name}
                                                </div>
                                                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                                    {folder.description}
                                                </div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                                    {isLoadingFolders ? 'Loading folders...' : 'No folders found'}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Indexing Options */}
                    {isAuthenticated && (
                        <div className="form-section pt-6">
                            <h3 className="form-section-title ui-text-secondary text-sm uppercase tracking-wide">
                                Indexing Options
                            </h3>

                            <div className="space-y-4">
                                <div className="form-group">
                                    <label className="label-base">
                                        Max Items: {config.maxItems}
                                    </label>
                                    <input
                                        type="range"
                                        min="100"
                                        max="10000"
                                        step="100"
                                        value={config.maxItems}
                                        onChange={(e) => setConfig(prev => ({ ...prev, maxItems: parseInt(e.target.value) }))}
                                        className="w-full"
                                    />
                                </div>

                                <div className="flex items-center">
                                    <input
                                        type="checkbox"
                                        id="includeShared"
                                        checked={config.includeShared}
                                        onChange={(e) => setConfig(prev => ({ ...prev, includeShared: e.target.checked }))}
                                        className="mr-2"
                                    />
                                    <label htmlFor="includeShared" className="label-inline">
                                        Include Shared Files
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Start Indexing */}
                    {isAuthenticated && (
                        <div className="flex gap-3 pt-6">
                            <button
                                onClick={handleStartIndexing}
                                disabled={isIndexing || config.selectedFolders.length === 0}
                                className="btn-primary flex-1"
                            >
                                <Play size={16} />
                                {isIndexing ? 'Indexing...' : 'Start Indexing'}
                            </button>
                        </div>
                    )}

                    {/* Jobs History */}
                    {jobs.length > 0 && (
                        <div className="pt-6">
                            <h3 className="form-section-title ui-text-secondary text-sm uppercase tracking-wide">
                                Indexing History
                            </h3>

                            <div className="space-y-3">
                                {jobs.map(job => (
                                    <div
                                        key={job.id}
                                        className="p-4 rounded-lg border"
                                        style={{
                                            background: 'var(--bg-tertiary)',
                                            borderColor: 'var(--border)'
                                        }}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                {getStatusIcon(job.status)}
                                                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    Google Drive Indexing
                                                </span>
                                            </div>
                                            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                                                {job.startedAt.toLocaleString()}
                                            </span>
                                        </div>

                                        {job.status === 'running' && (
                                            <div className="mb-2">
                                                <div className="flex justify-between text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                                                    <span>Progress: {job.progress}%</span>
                                                    <span>{job.indexedItems} items indexed</span>
                                                </div>
                                                <div
                                                    className="w-full h-2 rounded-full overflow-hidden"
                                                    style={{ background: 'var(--bg-primary)' }}
                                                >
                                                    <div
                                                        className="h-2 rounded-full transition-all"
                                                        style={{
                                                            background: 'var(--accent)',
                                                            width: `${job.progress}%`
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {job.error && (
                                            <p className="text-sm mt-2" style={{ color: 'var(--error)' }}>
                                                {job.error}
                                            </p>
                                        )}

                                        {job.completedAt && (
                                            <p className="text-sm mt-2" style={{ color: 'var(--success)' }}>
                                                Completed at {job.completedAt.toLocaleString()}
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {alertConfig && (
                <AlertModal
                    isOpen={showAlert}
                    title={alertConfig.title}
                    message={alertConfig.message}
                    type={alertConfig.type}
                    onClose={() => {
                        setShowAlert(false)
                        setAlertConfig(null)
                    }}
                />
            )}
        </div>
    )
}
