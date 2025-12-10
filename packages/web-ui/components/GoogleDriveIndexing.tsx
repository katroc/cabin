'use client'

import { useState, useEffect } from 'react'
import { HardDrive, Play, RefreshCw, CheckCircle, AlertCircle, Clock, ArrowLeft, X, FolderOpen, LogOut, ExternalLink } from 'lucide-react'
import AlertModal from './AlertModal'
import { useToast } from './ToastProvider'
import { getApiUrl } from '../lib/config'

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

    const [isConfigured, setIsConfigured] = useState(false)
    const [isConnected, setIsConnected] = useState(false)
    const [userEmail, setUserEmail] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [folders, setFolders] = useState<DriveFolder[]>([])
    const [selectedFolders, setSelectedFolders] = useState<string[]>([])
    const [isLoadingFolders, setIsLoadingFolders] = useState(false)
    const [maxItems, setMaxItems] = useState(1000)
    const [jobs, setJobs] = useState<IndexingJob[]>([])
    const [isIndexing, setIsIndexing] = useState(false)
    const [showAlert, setShowAlert] = useState(false)
    const [alertConfig, setAlertConfig] = useState<{ title: string; message: string; type: 'success' | 'error' | 'info' } | null>(null)

    // Scheduled Sync State
    const [isSyncEnabled, setIsSyncEnabled] = useState(false)
    const [syncInterval, setSyncInterval] = useState(60)
    const [lastSync, setLastSync] = useState<string | null>(null)
    const [isSyncLoading, setIsSyncLoading] = useState(false)

    // Check connection status on mount and when URL has callback param
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const response = await fetch(getApiUrl('/api/data-sources/google-drive/status'))
                if (response.ok) {
                    const data = await response.json()
                    setIsConfigured(data.configured)
                    setIsConnected(data.connected)
                    setUserEmail(data.user_email)

                    // If connected, load folders
                    if (data.connected) {
                        loadFolders()
                    }
                }
            } catch (error) {
                console.error('Failed to check Google Drive status:', error)
            } finally {
                setIsLoading(false)
            }
        }

        if (isOpen) {
            checkStatus()
        }
    }, [isOpen])

    // Check for callback param
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search)
            if (params.get('show_data_sources') === 'google_drive') {
                // Clean up URL
                window.history.replaceState({}, '', window.location.pathname)
                addToast('Google Drive connected successfully!', 'success')
                // The component is already open if we're here
            }
        }
    }, [])

    const loadFolders = async () => {
        setIsLoadingFolders(true)
        try {
            const response = await fetch(getApiUrl('/api/data-sources/google-drive/discover'), {
                method: 'POST'
            })
            if (response.ok) {
                const data = await response.json()
                setFolders(data.sources || [])
            }
        } catch (error) {
            console.error('Failed to load folders:', error)
        } finally {
            setIsLoadingFolders(false)
        }
    }

    // Fetch sync status when connected
    useEffect(() => {
        if (isConnected) {
            fetchSyncStatus()
        }
    }, [isConnected])

    const fetchSyncStatus = async () => {
        try {
            const response = await fetch(getApiUrl('/api/data-sources/google-drive/sync-status'))
            if (response.ok) {
                const data = await response.json()
                setIsSyncEnabled(data.enabled)
                setSyncInterval(data.interval_minutes)
                setLastSync(data.last_sync)
            }
        } catch (error) {
            console.error('Failed to fetch sync status:', error)
        }
    }

    const handleSyncToggle = async (enabled: boolean) => {
        setIsSyncLoading(true)
        try {
            const endpoint = enabled
                ? getApiUrl('/api/data-sources/google-drive/enable-scheduled-sync')
                : getApiUrl('/api/data-sources/google-drive/disable-scheduled-sync')

            const body = enabled ? {
                interval_minutes: syncInterval,
                folder_ids: selectedFolders
            } : undefined

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined
            })

            if (response.ok) {
                const data = await response.json()
                setIsSyncEnabled(data.config.enabled)
                setSyncInterval(data.config.interval_minutes)
                addToast(`Scheduled sync ${enabled ? 'enabled' : 'disabled'}`, 'success')
            }
        } catch (error) {
            console.error('Failed to toggle sync:', error)
            addToast('Failed to update sync settings', 'error')
        } finally {
            setIsSyncLoading(false)
        }
    }

    const handleIntervalChange = async (minutes: number) => {
        setSyncInterval(minutes)
        if (isSyncEnabled) {
            // Update config immediately if enabled
            setIsSyncLoading(true)
            try {
                const response = await fetch(getApiUrl('/api/data-sources/google-drive/enable-scheduled-sync'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        interval_minutes: minutes,
                        folder_ids: selectedFolders
                    })
                })
                if (response.ok) {
                    addToast('Sync interval updated', 'success')
                }
            } catch (error) {
                console.error('Failed to update interval:', error)
            } finally {
                setIsSyncLoading(false)
            }
        }
    }

    const handleConnect = async () => {
        try {
            // Construct redirect URI for OAuth callback (must match backend config)
            const redirectUri = getApiUrl('/api/data-sources/google-drive/callback')
            // Return URL for final redirect after callback (current frontend origin)
            const returnUrl = window.location.origin

            const params = new URLSearchParams({
                redirect_uri: redirectUri,
                return_url: returnUrl
            })

            const response = await fetch(getApiUrl(`/api/data-sources/google-drive/auth-url?${params.toString()}`))
            if (response.ok) {
                const data = await response.json()
                // Redirect to Google OAuth
                window.location.href = data.auth_url
            } else {
                const error = await response.json()
                setAlertConfig({
                    title: 'Configuration Required',
                    message: error.detail || 'Google Drive is not configured on the server.',
                    type: 'error'
                })
                setShowAlert(true)
            }
        } catch (error) {
            console.error('Failed to get auth URL:', error)
            setAlertConfig({
                title: 'Connection Error',
                message: 'Failed to connect to the server.',
                type: 'error'
            })
            setShowAlert(true)
        }
    }

    const handleDisconnect = async () => {
        try {
            await fetch(getApiUrl('/api/data-sources/google-drive/disconnect'), {
                method: 'POST'
            })
            setIsConnected(false)
            setUserEmail(null)
            setFolders([])
            setSelectedFolders([])
            addToast('Google Drive disconnected', 'info')
        } catch (error) {
            console.error('Failed to disconnect:', error)
        }
    }

    const handleFolderToggle = (folderId: string) => {
        setSelectedFolders(prev =>
            prev.includes(folderId)
                ? prev.filter(id => id !== folderId)
                : [...prev, folderId]
        )
    }

    const handleStartIndexing = async () => {
        if (selectedFolders.length === 0) {
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
            const response = await fetch(getApiUrl('/api/data-sources/google-drive/index'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_ids: selectedFolders,
                    config: { max_items: maxItems }
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
                    const progressResponse = await fetch(getApiUrl(`/api/data-sources/jobs/${jobId}`))

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

    if (!isOpen) return null

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
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <RefreshCw className="animate-spin" size={24} style={{ color: 'var(--accent)' }} />
                        </div>
                    ) : !isConfigured ? (
                        /* Not Configured */
                        <div className="form-section pt-6 first:pt-0">
                            <div className="text-center py-8">
                                <AlertCircle size={48} className="mx-auto mb-4" style={{ color: 'var(--warning)' }} />
                                <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                                    Google Drive Not Configured
                                </h3>
                                <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                                    The server needs to be configured with Google OAuth credentials.
                                </p>
                                <div className="text-sm p-4 rounded-lg text-left" style={{
                                    background: 'var(--bg-tertiary)',
                                    border: '1px solid var(--border)'
                                }}>
                                    <p className="font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                                        Set these environment variables:
                                    </p>
                                    <code className="block text-xs p-2 rounded" style={{ background: 'var(--bg-primary)' }}>
                                        GOOGLE_DRIVE_CLIENT_ID=your-client-id<br />
                                        GOOGLE_DRIVE_CLIENT_SECRET=your-secret<br />
                                        GOOGLE_DRIVE_REDIRECT_URI=http://localhost:8788/api/data-sources/google-drive/callback
                                    </code>
                                </div>
                            </div>
                        </div>
                    ) : !isConnected ? (
                        /* Not Connected - Show Connect Button */
                        <div className="form-section pt-6 first:pt-0">
                            <div className="text-center py-8">
                                <HardDrive size={48} className="mx-auto mb-4" style={{ color: 'var(--accent)' }} />
                                <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                                    Connect Your Google Drive
                                </h3>
                                <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                                    Sign in with Google to index documents from your Drive.
                                </p>
                                <button
                                    onClick={handleConnect}
                                    className="btn-primary flex items-center gap-2 mx-auto"
                                >
                                    <ExternalLink size={16} />
                                    Connect with Google
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Connected - Show Folders */
                        <>
                            {/* Connection Status */}
                            <div className="form-section pt-6 first:pt-0">
                                <div className="flex items-center justify-between p-4 rounded-lg" style={{
                                    background: 'var(--bg-tertiary)',
                                    border: '1px solid var(--border)'
                                }}>
                                    <div className="flex items-center gap-3">
                                        <CheckCircle size={20} style={{ color: 'var(--success)' }} />
                                        <div>
                                            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                                Connected to Google Drive
                                            </div>
                                            {userEmail && (
                                                <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                                                    {userEmail}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleDisconnect}
                                        className="btn-secondary text-sm flex items-center gap-1"
                                    >
                                        <LogOut size={14} />
                                        Disconnect
                                    </button>
                                </div>
                            </div>

                            {/* Folder Selection */}
                            <div className="form-section pt-6">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="form-section-title ui-text-secondary text-sm uppercase tracking-wide">
                                        Select Folders to Index
                                    </h3>
                                    <button
                                        onClick={loadFolders}
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
                                                    background: selectedFolders.includes(folder.id)
                                                        ? 'var(--accent-muted)'
                                                        : 'var(--bg-tertiary)',
                                                    border: `1px solid ${selectedFolders.includes(folder.id) ? 'var(--accent)' : 'var(--border)'}`
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedFolders.includes(folder.id)}
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

                            {/* Scheduled Sync */}
                            <div className="form-section pt-6">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="form-section-title ui-text-secondary text-sm uppercase tracking-wide">
                                        Scheduled Sync
                                    </h3>
                                    {lastSync && (
                                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                            Last synced: {new Date(lastSync).toLocaleString()}
                                        </span>
                                    )}
                                </div>

                                <div className="p-4 rounded-lg border" style={{
                                    background: 'var(--bg-tertiary)',
                                    borderColor: 'var(--border)'
                                }}>
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isSyncEnabled ? 'bg-green-500/20' : 'bg-gray-500/20'}`}>
                                                <RefreshCw size={16} className={isSyncEnabled ? 'text-green-500 animate-spin' : 'text-gray-500'} style={{ animationDuration: '3s' }} />
                                            </div>
                                            <div>
                                                <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    Automatic Sync
                                                </div>
                                                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                                    {isSyncEnabled
                                                        ? `Syncing every ${syncInterval} minutes`
                                                        : 'Enable to keep files up to date'}
                                                </div>
                                            </div>
                                        </div>

                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={isSyncEnabled}
                                                onChange={(e) => handleSyncToggle(e.target.checked)}
                                                disabled={isSyncLoading || selectedFolders.length === 0}
                                            />
                                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                                        </label>
                                    </div>

                                    {isSyncEnabled && (
                                        <div className="pt-4 border-t border-[color:var(--border)]">
                                            <label className="label-base mb-2 block">Sync Interval</label>
                                            <select
                                                value={syncInterval}
                                                onChange={(e) => handleIntervalChange(parseInt(e.target.value))}
                                                className="input-base w-full"
                                                disabled={isSyncLoading}
                                            >
                                                <option value={15}>Every 15 minutes</option>
                                                <option value={30}>Every 30 minutes</option>
                                                <option value={60}>Every hour</option>
                                                <option value={360}>Every 6 hours</option>
                                                <option value={720}>Every 12 hours</option>
                                                <option value={1440}>Daily</option>
                                            </select>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Indexing Options */}
                            <div className="form-section pt-6">
                                <h3 className="form-section-title ui-text-secondary text-sm uppercase tracking-wide">
                                    Indexing Options
                                </h3>
                                <div className="form-group">
                                    <label className="label-base">
                                        Max Items: {maxItems}
                                    </label>
                                    <input
                                        type="range"
                                        min="100"
                                        max="10000"
                                        step="100"
                                        value={maxItems}
                                        onChange={(e) => setMaxItems(parseInt(e.target.value))}
                                        className="w-full"
                                    />
                                </div>
                            </div>

                            {/* Start Indexing */}
                            <div className="flex gap-3 pt-6">
                                <button
                                    onClick={handleStartIndexing}
                                    disabled={isIndexing || selectedFolders.length === 0}
                                    className="btn-primary flex-1"
                                >
                                    <Play size={16} />
                                    {isIndexing ? 'Indexing...' : 'Start Indexing'}
                                </button>
                            </div>
                        </>
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
