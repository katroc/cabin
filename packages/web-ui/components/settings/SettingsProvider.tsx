'use client'

import { createContext, useContext, useReducer, useEffect, ReactNode, useCallback, useRef } from 'react'

// Extended interface that includes all backend settings
export interface ExtendedSettingsData {
  // General
  theme: 'light' | 'dark'
  logLevel: string
  metricsEnabled: boolean
  maxMemoryMessages: number

  // AI Models - LLM Provider
  llmBaseUrl: string
  llmModel: string
  llmApiKey: string
  temperature: number

  // AI Models - Embedding Provider
  embeddingBaseUrl: string
  embeddingModel: string
  embeddingApiKey: string
  embeddingDimensions: number
  embeddingBatchSize: number

  // AI Models - Generation
  maxTokens: number
  streamingMaxTokens: number
  rephrasingMaxTokens: number
  maxCitations: number
  requireQuotes: boolean
  quoteMaxWords: number

  // Retrieval - Basic
  finalPassages: number
  cosineFloor: number
  minKeywordOverlap: number

  // Retrieval - Advanced
  denseK: number
  lexicalK: number
  rrfK: number
  mmrLambda: number

  // Retrieval - Features
  useReranker: boolean
  allowRerankerFallback: boolean
  useRm3: boolean

  // Retrieval - Database
  chromaHost: string
  chromaPort: number

  // Performance - Caching
  embeddingCacheEnabled: boolean
  embeddingCacheMaxItems: number
  embeddingCacheTtlSeconds: number

  // Performance - Processing
  chunkSizeTokens: number
  chunkStrideTokens: number
  maxHtmlChars: number

  // Performance - Reranker
  rerankerUrl: string
  rerankerPort: number
  rerankerTimeout: number
  rerankerPoolSizeMultiplier: number
  rerankerScoreWeight: number

  // Security - Privacy
  dropBoilerplate: boolean
  dropLabels: string[]

  // Advanced - Deduplication
  dedupEnabled: boolean
  dedupMethod: string
  dedupThreshold: number

  // Advanced - RM3
  rm3TopDocs: number
  rm3Terms: number
  rm3Alpha: number

  // Advanced - Verification
  fuzzyPartialRatioMin: number
}

interface SettingsState {
  data: ExtendedSettingsData
  originalData: ExtendedSettingsData
  hasUnsavedChanges: boolean
  isSaving: boolean
  isLoading: boolean
  lastSaved: Date | null
  saveError: string | null
  validationErrors: Record<string, string>
}

type SettingsAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_DATA'; payload: ExtendedSettingsData }
  | { type: 'UPDATE_SETTING'; payload: { key: keyof ExtendedSettingsData; value: any } }
  | { type: 'SET_SAVING'; payload: boolean }
  | { type: 'SAVE_SUCCESS'; payload: Date }
  | { type: 'SAVE_ERROR'; payload: string }
  | { type: 'SET_VALIDATION_ERROR'; payload: { key: string; error: string } }
  | { type: 'CLEAR_VALIDATION_ERROR'; payload: string }
  | { type: 'RESET_TO_ORIGINAL' }

const defaultSettings: ExtendedSettingsData = {
  // General
  theme: 'dark',
  logLevel: 'INFO',
  metricsEnabled: true,
  maxMemoryMessages: 8,

  // AI Models
  llmBaseUrl: 'http://localhost:1234/v1',
  llmModel: 'openai/gpt-oss-20b',
  llmApiKey: '',
  temperature: 0.1,
  embeddingBaseUrl: 'http://localhost:1234/v1',
  embeddingModel: 'text-embedding-bge-m3',
  embeddingApiKey: '',
  embeddingDimensions: 256,
  embeddingBatchSize: 16,
  maxTokens: 8000,
  streamingMaxTokens: 8000,
  rephrasingMaxTokens: 4000,
  maxCitations: 3,
  requireQuotes: true,
  quoteMaxWords: 12,

  // Retrieval
  finalPassages: 8,
  cosineFloor: 0.05,
  minKeywordOverlap: 2,
  denseK: 80,
  lexicalK: 80,
  rrfK: 60,
  mmrLambda: 0.5,
   useReranker: true,
   allowRerankerFallback: true,
   useRm3: false,
  chromaHost: 'localhost',
  chromaPort: 8100,

  // Performance
  embeddingCacheEnabled: true,
  embeddingCacheMaxItems: 512,
  embeddingCacheTtlSeconds: 600,
  chunkSizeTokens: 250,
  chunkStrideTokens: 75,
  maxHtmlChars: 500000,
  rerankerUrl: 'http://localhost:8002/rerank',
  rerankerPort: 8002,
  rerankerTimeout: 8,
  rerankerPoolSizeMultiplier: 3,
  rerankerScoreWeight: 0.7,

  // Security
  dropBoilerplate: true,
  dropLabels: ['template', 'archive', 'index'],

  // Advanced
  dedupEnabled: true,
  dedupMethod: 'minhash',
  dedupThreshold: 0.92,
  rm3TopDocs: 10,
  rm3Terms: 10,
  rm3Alpha: 0.4,
  fuzzyPartialRatioMin: 70
}

function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload }

    case 'SET_DATA':
      return {
        ...state,
        data: action.payload,
        originalData: action.payload,
        hasUnsavedChanges: false,
        isLoading: false,
        saveError: null
      }

    case 'UPDATE_SETTING':
      const newData = { ...state.data, [action.payload.key]: action.payload.value }
      return {
        ...state,
        data: newData,
        hasUnsavedChanges: JSON.stringify(newData) !== JSON.stringify(state.originalData)
      }

    case 'SET_SAVING':
      return { ...state, isSaving: action.payload, saveError: null }

    case 'SAVE_SUCCESS':
      return {
        ...state,
        originalData: state.data,
        hasUnsavedChanges: false,
        isSaving: false,
        lastSaved: action.payload,
        saveError: null
      }

    case 'SAVE_ERROR':
      return {
        ...state,
        isSaving: false,
        saveError: action.payload
      }

    case 'SET_VALIDATION_ERROR':
      return {
        ...state,
        validationErrors: {
          ...state.validationErrors,
          [action.payload.key]: action.payload.error
        }
      }

    case 'CLEAR_VALIDATION_ERROR':
      const { [action.payload]: _, ...rest } = state.validationErrors
      return {
        ...state,
        validationErrors: rest
      }

    case 'RESET_TO_ORIGINAL':
      return {
        ...state,
        data: state.originalData,
        hasUnsavedChanges: false,
        validationErrors: {}
      }

    default:
      return state
  }
}

interface SettingsContextType {
  state: SettingsState
  updateSetting: (key: keyof ExtendedSettingsData, value: any) => void
  saveSetting: () => Promise<void>
  resetSettings: () => void
  validateSetting: (key: string, value: any) => string | null
}

const SettingsContext = createContext<SettingsContextType | null>(null)

interface SettingsProviderProps {
  children: ReactNode
  settingsEndpoint?: string
}

export function SettingsProvider({
  children,
  settingsEndpoint = 'http://localhost:8788/api/settings'
}: SettingsProviderProps) {
  const [state, dispatch] = useReducer(settingsReducer, {
    data: defaultSettings,
    originalData: defaultSettings,
    hasUnsavedChanges: false,
    isSaving: false,
    isLoading: true,
    lastSaved: null,
    saveError: null,
    validationErrors: {}
  })

  // Load settings from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      dispatch({ type: 'SET_LOADING', payload: true })

      try {
        const response = await fetch(settingsEndpoint)
        if (!response.ok) {
          throw new Error(`Failed to load settings: ${response.status}`)
        }

        const data = await response.json()

        // Map backend data to our extended format
        const mappedData: ExtendedSettingsData = {
          ...defaultSettings,
          ...data,
          // Map any renamed fields
          theme: localStorage.getItem('theme') as 'light' | 'dark' || 'dark',
          metricsEnabled: data.metricsEnabled ?? true,
        }

        dispatch({ type: 'SET_DATA', payload: mappedData })
      } catch (error) {
        console.error('Failed to load settings:', error)
        dispatch({ type: 'SET_DATA', payload: defaultSettings })
      }
    }

    loadSettings()
  }, [settingsEndpoint])

  // Auto-save with debouncing
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const updateSetting = useCallback((key: keyof ExtendedSettingsData, value: any) => {
    // Clear any existing validation error
    dispatch({ type: 'CLEAR_VALIDATION_ERROR', payload: key })

    // Validate the new value
    const error = validateSetting(key, value)
    if (error) {
      dispatch({ type: 'SET_VALIDATION_ERROR', payload: { key, error } })
      return
    }

    // Update the setting
    dispatch({ type: 'UPDATE_SETTING', payload: { key, value } })
  }, [])

  const saveSetting = useCallback(async () => {
    dispatch({ type: 'SET_SAVING', payload: true })

    try {
      // Convert our extended format back to backend format
      // Only send backend-relevant settings, exclude UI-only settings like theme
      const backendData = {
        // General
        logLevel: state.data.logLevel,
        metricsEnabled: state.data.metricsEnabled,
        maxMemoryMessages: state.data.maxMemoryMessages,

        // AI Models - LLM Provider
        llmBaseUrl: state.data.llmBaseUrl,
        llmModel: state.data.llmModel,
        llmApiKey: state.data.llmApiKey,
        temperature: state.data.temperature,

        // AI Models - Embedding Provider
        embeddingBaseUrl: state.data.embeddingBaseUrl,
        embeddingModel: state.data.embeddingModel,
        embeddingApiKey: state.data.embeddingApiKey,
        embeddingDimensions: state.data.embeddingDimensions,
        embeddingBatchSize: state.data.embeddingBatchSize,

        // AI Models - Generation
        maxTokens: state.data.maxTokens,
        streamingMaxTokens: state.data.streamingMaxTokens,
        rephrasingMaxTokens: state.data.rephrasingMaxTokens,
        maxCitations: state.data.maxCitations,
        requireQuotes: state.data.requireQuotes,
        quoteMaxWords: state.data.quoteMaxWords,

        // Retrieval - Basic
        finalPassages: state.data.finalPassages,
        cosineFloor: state.data.cosineFloor,
        minKeywordOverlap: state.data.minKeywordOverlap,

        // Retrieval - Advanced
        denseK: state.data.denseK,
        lexicalK: state.data.lexicalK,
        rrfK: state.data.rrfK,
        mmrLambda: state.data.mmrLambda,

        // Retrieval - Features
        useReranker: state.data.useReranker,
        allowRerankerFallback: state.data.allowRerankerFallback,
        useRm3: state.data.useRm3,

        // Retrieval - Database
        chromaHost: state.data.chromaHost,
        chromaPort: state.data.chromaPort,

        // Performance - Caching
        embeddingCacheEnabled: state.data.embeddingCacheEnabled,
        embeddingCacheMaxItems: state.data.embeddingCacheMaxItems,
        embeddingCacheTtlSeconds: state.data.embeddingCacheTtlSeconds,

        // Performance - Processing
        chunkSizeTokens: state.data.chunkSizeTokens,
        chunkStrideTokens: state.data.chunkStrideTokens,
        maxHtmlChars: state.data.maxHtmlChars,

        // Performance - Reranker
        rerankerUrl: state.data.rerankerUrl,
        rerankerPort: state.data.rerankerPort,
        rerankerTimeout: state.data.rerankerTimeout,
        rerankerPoolSizeMultiplier: state.data.rerankerPoolSizeMultiplier,
        rerankerScoreWeight: state.data.rerankerScoreWeight,

        // Security - Privacy
        dropBoilerplate: state.data.dropBoilerplate,
        dropLabels: state.data.dropLabels,

        // Advanced - Deduplication
        dedupEnabled: state.data.dedupEnabled,
        dedupMethod: state.data.dedupMethod,
        dedupThreshold: state.data.dedupThreshold,

        // Advanced - RM3
        rm3TopDocs: state.data.rm3TopDocs,
        rm3Terms: state.data.rm3Terms,
        rm3Alpha: state.data.rm3Alpha,

        // Advanced - Verification
        fuzzyPartialRatioMin: state.data.fuzzyPartialRatioMin
      }

      const response = await fetch(settingsEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backendData)
      })

      if (!response.ok) {
        throw new Error(`Failed to save settings: ${response.status}`)
      }

      // Save theme to localStorage
      localStorage.setItem('theme', state.data.theme)
      document.documentElement.setAttribute('data-theme', state.data.theme)

      dispatch({ type: 'SAVE_SUCCESS', payload: new Date() })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      dispatch({ type: 'SAVE_ERROR', payload: errorMessage })
    }
  }, [state.data, settingsEndpoint])

  const resetSettings = useCallback(() => {
    dispatch({ type: 'RESET_TO_ORIGINAL' })
  }, [])

  const validateSetting = useCallback((key: string, value: any): string | null => {
    // URL validation
    if (key.includes('Url') || key.includes('BaseUrl')) {
      if (value && typeof value === 'string') {
        try {
          new URL(value)
        } catch {
          return 'Please enter a valid URL'
        }
      }
    }

    // Port validation
    if (key.includes('Port')) {
      const port = Number(value)
      if (isNaN(port) || port < 1 || port > 65535) {
        return 'Port must be between 1 and 65535'
      }
    }

    // Specific field validations
    switch (key) {
      case 'temperature':
        const temp = Number(value)
        if (isNaN(temp) || temp < 0 || temp > 2) {
          return 'Temperature must be between 0 and 2'
        }
        break

      case 'cosineFloor':
        const floor = Number(value)
        if (isNaN(floor) || floor < 0 || floor > 1) {
          return 'Cosine floor must be between 0 and 1'
        }
        break

      case 'mmrLambda':
        const lambda = Number(value)
        if (isNaN(lambda) || lambda < 0 || lambda > 1) {
          return 'MMR Lambda must be between 0 and 1'
        }
        break

      case 'dedupThreshold':
        const threshold = Number(value)
        if (isNaN(threshold) || threshold < 0.5 || threshold > 1) {
          return 'Deduplication threshold must be between 0.5 and 1.0'
        }
        break

      case 'rm3Alpha':
        const alpha = Number(value)
        if (isNaN(alpha) || alpha < 0 || alpha > 1) {
          return 'RM3 Alpha must be between 0 and 1'
        }
        break

      case 'rerankerScoreWeight':
        const weight = Number(value)
        if (isNaN(weight) || weight < 0 || weight > 1) {
          return 'Reranker score weight must be between 0 and 1'
        }
        break

      case 'embeddingDimensions':
        const dims = Number(value)
        if (isNaN(dims) || dims < 64 || dims > 4096) {
          return 'Embedding dimensions must be between 64 and 4096'
        }
        break

      case 'embeddingBatchSize':
        const batchSize = Number(value)
        if (isNaN(batchSize) || batchSize < 1 || batchSize > 100) {
          return 'Batch size must be between 1 and 100'
        }
        break

      case 'maxMemoryMessages':
        const messages = Number(value)
        if (isNaN(messages) || messages < 1 || messages > 50) {
          return 'Memory messages must be between 1 and 50'
        }
        break

      case 'finalPassages':
        const passages = Number(value)
        if (isNaN(passages) || passages < 1 || passages > 50) {
          return 'Final passages must be between 1 and 50'
        }
        break

      case 'minKeywordOverlap':
        const overlap = Number(value)
        if (isNaN(overlap) || overlap < 0 || overlap > 10) {
          return 'Minimum keyword overlap must be between 0 and 10'
        }
        break

      case 'denseK':
      case 'lexicalK':
        const k = Number(value)
        if (isNaN(k) || k < 10 || k > 500) {
          return 'K value must be between 10 and 500'
        }
        break

      case 'rrfK':
        const rrfK = Number(value)
        if (isNaN(rrfK) || rrfK < 1 || rrfK > 100) {
          return 'RRF K must be between 1 and 100'
        }
        break

      case 'maxCitations':
        const citations = Number(value)
        if (isNaN(citations) || citations < 0 || citations > 20) {
          return 'Max citations must be between 0 and 20'
        }
        break

      case 'quoteMaxWords':
        const words = Number(value)
        if (isNaN(words) || words < 5 || words > 100) {
          return 'Quote max words must be between 5 and 100'
        }
        break

      case 'embeddingCacheMaxItems':
        const cacheItems = Number(value)
        if (isNaN(cacheItems) || cacheItems < 10 || cacheItems > 10000) {
          return 'Cache max items must be between 10 and 10,000'
        }
        break

      case 'embeddingCacheTtlSeconds':
        const ttl = Number(value)
        if (isNaN(ttl) || ttl < 60 || ttl > 86400) {
          return 'Cache TTL must be between 1 minute and 24 hours'
        }
        break

      case 'chunkSizeTokens':
        const chunkSize = Number(value)
        if (isNaN(chunkSize) || chunkSize < 50 || chunkSize > 2000) {
          return 'Chunk size must be between 50 and 2000 tokens'
        }
        break

      case 'chunkStrideTokens':
        const stride = Number(value)
        if (isNaN(stride) || stride < 0 || stride > 500) {
          return 'Chunk stride must be between 0 and 500 tokens'
        }
        break

      case 'maxHtmlChars':
        const htmlChars = Number(value)
        if (isNaN(htmlChars) || htmlChars < 10000 || htmlChars > 10000000) {
          return 'Max HTML characters must be between 10K and 10M'
        }
        break

      case 'rerankerTimeout':
        const timeout = Number(value)
        if (isNaN(timeout) || timeout < 1 || timeout > 60) {
          return 'Reranker timeout must be between 1 and 60 seconds'
        }
        break

      case 'rerankerPoolSizeMultiplier':
        const multiplier = Number(value)
        if (isNaN(multiplier) || multiplier < 1 || multiplier > 10) {
          return 'Pool size multiplier must be between 1 and 10'
        }
        break

      case 'rm3TopDocs':
        const topDocs = Number(value)
        if (isNaN(topDocs) || topDocs < 1 || topDocs > 50) {
          return 'RM3 top documents must be between 1 and 50'
        }
        break

      case 'rm3Terms':
        const terms = Number(value)
        if (isNaN(terms) || terms < 1 || terms > 50) {
          return 'RM3 terms must be between 1 and 50'
        }
        break

      case 'fuzzyPartialRatioMin':
        const ratio = Number(value)
        if (isNaN(ratio) || ratio < 0 || ratio > 100) {
          return 'Fuzzy ratio must be between 0 and 100'
        }
        break

      case 'logLevel':
        const validLevels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']
        if (!validLevels.includes(value)) {
          return 'Invalid log level'
        }
        break

      case 'theme':
        if (value !== 'light' && value !== 'dark') {
          return 'Theme must be light or dark'
        }
        break

      case 'dedupMethod':
        const validMethods = ['minhash', 'jaccard', 'cosine', 'fuzzy']
        if (!validMethods.includes(value)) {
          return 'Invalid deduplication method'
        }
        break

      case 'llmModel':
      case 'embeddingModel':
        if (value && typeof value === 'string' && value.trim().length === 0) {
          return 'Model name cannot be empty'
        }
        break

      case 'chromaHost':
        if (value && typeof value === 'string' && value.trim().length === 0) {
          return 'Host cannot be empty'
        }
        break
    }

    // Token limits
    if (key.includes('Tokens')) {
      const tokens = Number(value)
      if (isNaN(tokens) || tokens < 100 || tokens > 50000) {
        return 'Token limit must be between 100 and 50,000'
      }
    }

    return null
  }, [])

  // Auto-save effect (defined after saveSetting to avoid circular dependency)
  useEffect(() => {
    // Only auto-save if we have unsaved changes and we're not currently saving
    if (state.hasUnsavedChanges && !state.isSaving && !state.isLoading) {
      // Clear any existing timeout
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current)
      }

      // Set a new timeout for auto-save (3 seconds after last change)
      autoSaveTimeoutRef.current = setTimeout(async () => {
        try {
          await saveSetting()
        } catch (error) {
          console.error('Auto-save failed:', error)
        }
      }, 3000)
    }

    // Cleanup timeout on unmount or when dependencies change
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current)
      }
    }
  }, [state.hasUnsavedChanges, state.isSaving, state.isLoading, saveSetting])

  const contextValue: SettingsContextType = {
    state,
    updateSetting,
    saveSetting,
    resetSettings,
    validateSetting
  }

  return (
    <SettingsContext.Provider value={contextValue}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}