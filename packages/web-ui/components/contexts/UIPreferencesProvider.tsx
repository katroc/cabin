'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export type PersonaType = 'standard' | 'direct' | 'eli5'
export type ChatMode = 'rag' | 'llm'

interface UIPreferences {
  persona: PersonaType
  chatMode: ChatMode
}

interface UIPreferencesContextType {
  preferences: UIPreferences
  setPersona: (persona: PersonaType) => void
  setChatMode: (mode: ChatMode) => void
}

const defaultPreferences: UIPreferences = {
  persona: 'standard',
  chatMode: 'rag'
}

const UIPreferencesContext = createContext<UIPreferencesContextType | null>(null)

interface UIPreferencesProviderProps {
  children: ReactNode
}

export function UIPreferencesProvider({ children }: UIPreferencesProviderProps) {
  const [preferences, setPreferences] = useState<UIPreferences>(defaultPreferences)

  // Load preferences from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('cabin-ui-preferences')
      if (stored) {
        const parsed = JSON.parse(stored)
        setPreferences({
          persona: parsed.persona || defaultPreferences.persona,
          chatMode: parsed.chatMode || defaultPreferences.chatMode
        })
      }
    } catch (error) {
      console.warn('Failed to load UI preferences from localStorage:', error)
    }
  }, [])

  // Save preferences to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('cabin-ui-preferences', JSON.stringify(preferences))
    } catch (error) {
      console.warn('Failed to save UI preferences to localStorage:', error)
    }
  }, [preferences])

  const setPersona = (persona: PersonaType) => {
    setPreferences(prev => ({ ...prev, persona }))
  }

  const setChatMode = (chatMode: ChatMode) => {
    setPreferences(prev => ({ ...prev, chatMode }))
  }

  const contextValue: UIPreferencesContextType = {
    preferences,
    setPersona,
    setChatMode
  }

  return (
    <UIPreferencesContext.Provider value={contextValue}>
      {children}
    </UIPreferencesContext.Provider>
  )
}

export function useUIPreferences() {
  const context = useContext(UIPreferencesContext)
  if (!context) {
    throw new Error('useUIPreferences must be used within a UIPreferencesProvider')
  }
  return context
}