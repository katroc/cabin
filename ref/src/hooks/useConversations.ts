import { useState, useEffect } from 'react';
import { stripThinking } from '@app/shared';
import { generateConversationTitle, shouldUpdateTitle } from '../utils/titleSummarization';

export interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  thinking?: string; // thinking content for assistant messages
  citations?: Array<{
    pageId: string;
    title: string;
    url: string;
    sectionAnchor?: string;
    snippet?: string;
  }>;
  displayCitations?: Array<{
    pageId: string;
    title: string;
    url: string;
    sectionAnchor?: string;
    snippet?: string;
  }>;
  citationIndexMap?: number[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  generatingTitle?: boolean;
  pinned?: boolean;
}

const STORAGE_KEYS = {
  conversations: 'chat:conversations:v1',
  activeId: 'chat:activeId:v1',
} as const;

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      if (typeof window === 'undefined') return [];
      const raw = localStorage.getItem(STORAGE_KEYS.conversations);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as Conversation[];
      }
      // Migration: check old messages key
      const legacy = localStorage.getItem('chat:messages:v1');
      if (legacy) {
        const msgs = JSON.parse(legacy) as Message[];
        const now = Date.now();
        const conv: Conversation = {
          id: String(now),
          title: msgs.find(m => m.type === 'user')?.content?.slice(0, 60) || 'Conversation',
          createdAt: now,
          updatedAt: now,
          messages: msgs,
        };
        return [conv];
      }
      return [];
    } catch {
      return [];
    }
  });

  const [activeId, setActiveId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEYS.activeId) || null;
  });

  // Persist conversations
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.conversations, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (activeId) localStorage.setItem(STORAGE_KEYS.activeId, activeId);
  }, [activeId]);

  const createConversation = () => {
    const now = Date.now();
    const conv: Conversation = { id: String(now), title: 'New conversation', createdAt: now, updatedAt: now, messages: [] };
    setConversations(prev => [conv, ...prev]);
    setActiveId(conv.id);
  };

  const deleteConversation = (id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeId === id) {
      const remaining = conversations.filter(c => c.id !== id);
      setActiveId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const deleteAllConversations = () => {
    setConversations([]);
    setActiveId(null);
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(STORAGE_KEYS.conversations);
        localStorage.removeItem(STORAGE_KEYS.activeId);
      }
    } catch {
      // ignore storage errors
    }
  };

  const renameConversation = (id: string, newTitle: string) => {
    setConversations(prev => prev.map(c =>
      c.id === id ? { ...c, title: newTitle, updatedAt: Date.now() } : c
    ));
  };

  const togglePinConversation = (id: string) => {
    setConversations(prev => prev.map(c =>
      c.id === id ? { ...c, pinned: !c.pinned, updatedAt: Date.now() } : c
    ));
  };

  const addMessage = (conversationId: string, message: Message) => {
    setConversations(prev => {
      const list = [...prev];
      const idx = list.findIndex(c => c.id === conversationId);
      if (idx >= 0) {
        const conv = { ...list[idx] };
        conv.messages = [...conv.messages, message];
        conv.updatedAt = Date.now();
        if (!conv.title || conv.title === 'New conversation') {
          conv.title = message.content.slice(0, 60);
        }
        list[idx] = conv;
      }
      return list;
    });
  };

  const updateConversationTitle = async (conversationId: string, selectedModel?: string) => {
    setConversations(currentList => {
      const updatedList = [...currentList];
      const convIdx = updatedList.findIndex(c => c.id === conversationId);
      if (convIdx >= 0) {
        updatedList[convIdx] = { ...updatedList[convIdx], generatingTitle: true };
      }
      return updatedList;
    });

    const conv = conversations.find(c => c.id === conversationId);
    if (!conv) return;

    const firstUserMsg = conv.messages.find(m => m.type === 'user')?.content;

    if (shouldUpdateTitle(conv.title, conv.messages.length, firstUserMsg)) {
      const sanitizedMessages = conv.messages.map(m => (
        m.type === 'assistant' ? { ...m, content: stripThinking(m.content) } : m
      ));

      try {
        const newTitle = await generateConversationTitle(sanitizedMessages as any, selectedModel);
        setConversations(currentList => {
          const updatedList = [...currentList];
          const convIdx = updatedList.findIndex(c => c.id === conversationId);
          if (convIdx >= 0) {
            updatedList[convIdx] = { ...updatedList[convIdx], title: newTitle, generatingTitle: false };
          }
          return updatedList;
        });
      } catch (error) {
        console.warn('Failed to update conversation title:', error);
        setConversations(currentList => {
          const updatedList = [...currentList];
          const convIdx = updatedList.findIndex(c => c.id === conversationId);
          if (convIdx >= 0) {
            updatedList[convIdx] = { ...updatedList[convIdx], generatingTitle: false };
          }
          return updatedList;
        });
      }
    }
  };

  return {
    conversations,
    activeId,
    setActiveId,
    createConversation,
    deleteConversation,
    deleteAllConversations,
    renameConversation,
    togglePinConversation,
    addMessage,
    updateConversationTitle,
  };
}