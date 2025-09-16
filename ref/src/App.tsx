import React, { useState, useRef, useEffect } from 'react';
import type { RagQuery } from '@app/shared';
import { stripThinking } from '@app/shared';
import { SmartResponse } from './SmartResponse';
import { LoadingProgress } from './components/LoadingProgress';
import { HistoryPane, type HistoryConversation } from './components/HistoryPane';
import { splitThinking, deriveAnswerFromThinking } from './utils/thinking';
import { useConversations } from './hooks/useConversations';
import { useSettings } from './hooks/useSettings';
import { useConnection } from './hooks/useConnection';
import { useModels } from './hooks/useModels';
import { SettingsDrawer } from './components/SettingsDrawer';
import { NotificationToast } from './components/NotificationToast';
import { DeleteAllModal } from './components/DeleteAllModal';



interface Message {
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
  citationIndexMap?: number[]; // original index -> display index
}



function App() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  // Use custom hooks for state management
  const conversationsHook = useConversations();
  const settingsHook = useSettings();
  const connectionHook = useConnection();
  const modelsHook = useModels();

  // Local state
  const [input, setInput] = useState<string>(() => (typeof window !== 'undefined' ? localStorage.getItem('chat:draft:v1') || '' : ''));
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [animatingMessageId, setAnimatingMessageId] = useState<string | null>(null);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState<Record<string, boolean>>({});

  // Crawler config state (admin)
  const [crawlerAllSpaces, setCrawlerAllSpaces] = useState(true);
  const [crawlerSpaces, setCrawlerSpaces] = useState('');
  const [crawlerPageSize, setCrawlerPageSize] = useState(50);
  const [crawlerMaxPages, setCrawlerMaxPages] = useState(200);
  const [crawlerConcurrency, setCrawlerConcurrency] = useState(4);
  const [availableSpaces, setAvailableSpaces] = useState<string[]>([]);
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error' | 'info'} | null>(null);

  // Extract from hooks
  const {
    conversations,
    activeId,
    setActiveId,
    createConversation,
    deleteConversation,
    deleteAllConversations,
    renameConversation,
    togglePinConversation,
    addMessage,
    updateConversationTitle
  } = conversationsHook;

  const {
    space, setSpace,
    labels, setLabels,
    topK, setTopK,
    temperature, setTemperature,
    ragBypass, setRagBypass,
    theme, setTheme,
    ragConfig, setRagConfig
  } = settingsHook;

  const { isOnline, connectionError } = connectionHook;
  const { availableModels, selectedModel, setSelectedModel } = modelsHook;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const toggleThinking = (id: string) => {
    setThinkingOpen(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Effects
  useEffect(() => {
    scrollToBottom();
  }, [conversations, activeId]);

  useEffect(() => {
    if (animatingMessageId) {
      const timeout = setTimeout(() => {
        setAnimatingMessageId(null);
      }, 5000);
      return () => clearTimeout(timeout);
    }
  }, [animatingMessageId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
        setExportDropdownOpen(false);
      }
    };

    if (exportDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [exportDropdownOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('chat:draft:v1', input);
  }, [input]);


  // Load crawler config and RAG settings when settings drawer opens
  useEffect(() => {
    if (!settingsOpen) return;

    (async () => {
      try {
        const res = await fetch('/admin/crawler/config');
        if (res.ok) {
          const cfg = await res.json();
          setCrawlerAllSpaces(!!cfg.allSpaces);
          setCrawlerSpaces(Array.isArray(cfg.spaces) ? cfg.spaces.join(',') : '');
          setCrawlerPageSize(Number(cfg.pageSize || 50));
          setCrawlerMaxPages(Number(cfg.maxPagesPerTick || 200));
          setCrawlerConcurrency(Number(cfg.concurrency || 4));
        }
      } catch {}
    })();

    (async () => {
      try {
        const res = await fetch('/admin/rag/config');
        if (res.ok) {
          const config = await res.json();
          setRagConfig(config);
        }
      } catch {}
    })();
  }, [settingsOpen]);

  const refreshSpaces = async () => {
    try {
      const res = await fetch('/admin/confluence/spaces');
      if (res.ok) {
        const data = await res.json();
        setAvailableSpaces(Array.isArray(data.spaces) ? data.spaces : []);
      }
    } catch {}
  };

  const saveCrawlerConfig = async () => {
    try {
      const body = {
        allSpaces: crawlerAllSpaces,
        spaces: crawlerAllSpaces ? [] : crawlerSpaces.split(',').map(s => s.trim()).filter(Boolean),
        pageSize: crawlerPageSize,
        maxPagesPerTick: crawlerMaxPages,
        concurrency: crawlerConcurrency
      };
      const res = await fetch('/admin/crawler/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        showNotification('Crawler configuration saved successfully!', 'success');
      } else {
        showNotification('Failed to save crawler configuration', 'error');
      }
    } catch (error) {
      showNotification('Error saving crawler configuration', 'error');
    }
  };

  const triggerSync = async () => {
    try {
      const body: any = {};
      if (!crawlerAllSpaces) {
        body.spaces = crawlerSpaces.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
      body.pageSize = crawlerPageSize;
      body.maxPages = crawlerMaxPages;
      const res = await fetch('/admin/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        showNotification('Sync started successfully! This may take a few moments to complete.', 'info');
      } else {
        showNotification('Failed to start sync', 'error');
      }
    } catch (error) {
      showNotification('Error starting sync', 'error');
    }
  };

  const saveRagConfig = async () => {
    try {
      const res = await fetch('/admin/rag/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ragConfig)
      });
      if (res.ok) {
        const updatedConfig = await res.json();
        setRagConfig(updatedConfig);
        showNotification('RAG settings saved successfully!', 'success');
      } else {
        showNotification('Failed to save RAG settings', 'error');
      }
    } catch {
      showNotification('Error saving RAG settings', 'error');
    }
  };

  const openDeleteAllModal = () => {
    setDeleteAllOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const exportConversation = (format: 'markdown' | 'json') => {
    if (!current) {return;}

    const timestamp = new Date(current.updatedAt).toLocaleString();
    let content: string;
    let filename: string;
    let mimeType: string;

    // Helper: compute only the citations that were actually referenced in the answer text
    const getReferencedCitations = (
      message: Message
    ): Array<{ pageId: string; title: string; url: string; sectionAnchor?: string; snippet?: string }> => {
      const text = message.content || '';
      const all = message.citations || [];
      const display = message.displayCitations || [];
      const map = message.citationIndexMap || [];
      const numsInOrder: number[] = [];
      const seen = new Set<number>();
      const re = /\[(\d+)\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const n = parseInt(m[1], 10);
        if (!Number.isNaN(n) && n > 0 && !seen.has(n)) {
          seen.add(n);
          numsInOrder.push(n);
        }
      }
      const uniqueBy = new Set<string>();
      const picked: typeof all = [];
      for (const n of numsInOrder) {
        const idx0 = n - 1;
        let cit = all[idx0];
        if (display.length > 0 && map.length > idx0 && typeof map[idx0] === 'number') {
          const dispIdx = map[idx0] as number;
          cit = display[dispIdx] || cit;
        }
        if (cit) {
          const key = `${cit.pageId}|${cit.url}`;
          if (!uniqueBy.has(key)) {
            uniqueBy.add(key);
            picked.push(cit);
          }
        }
      }
      return picked;
    };

    const safeTitle = stripThinking(current.title || '').trim() || (current.title || 'Conversation');

    if (format === 'markdown') {
      content = `# ${safeTitle}\n\n*Exported: ${timestamp}*\n\n`;
      
      current.messages.forEach(msg => {
        if (msg.type === 'user') {
          content += `## User\n\n${msg.content}\n\n`;
        } else {
          const visible = (msg.content || '').trim() || deriveAnswerFromThinking(msg.thinking || '');
          content += `## Assistant\n\n${visible}\n\n`;
          const referenced = getReferencedCitations({ ...msg, content: visible } as any);
          if (referenced.length > 0) {
            content += `### Sources\n\n`;
            referenced.forEach((citation, idx) => {
              content += `${idx + 1}. [${citation.title}](${citation.url})\n`;
            });
            content += '\n';
          }
        }
      });

      filename = `${current.title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')}.md`;
      mimeType = 'text/markdown';
    } else {
      content = JSON.stringify({
        id: current.id,
        title: safeTitle,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        exportedAt: Date.now(),
        messages: current.messages.map(msg => {
          if (msg.type === 'assistant') {
            const visible = (msg.content || '').trim() || deriveAnswerFromThinking(msg.thinking || '');
            return {
              id: msg.id,
              type: msg.type,
              content: visible,
              citations: getReferencedCitations({ ...msg, content: visible } as any)
            };
          }
          return {
            id: msg.id,
            type: msg.type,
            content: msg.content,
            citations: [] as any[]
          };
        })
      }, null, 2);

      filename = `${current.title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')}.json`;
      mimeType = 'application/json';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const current = conversations.find(c => c.id === activeId) || conversations[0];
  useEffect(() => {
    if (!activeId && conversations.length > 0) {setActiveId(conversations[0].id);}
  }, [activeId, conversations.length]);

  // Focus input when switching conversations
  useEffect(() => {
    if (activeId) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [activeId]);

  const stopGeneration = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const controller = new AbortController();
    setAbortController(controller);

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: input.trim()
    };

    const currentConvId = current?.id || activeId;
    if (!currentConvId) {
      createConversation();
    }

    addMessage(currentConvId || activeId || '', userMessage);
    setIsLoading(true);

    const assistantMessageId = (Date.now() + 1).toString();

    try {
      const query: RagQuery = {
        question: input.trim(),
        space: space || undefined,
        labels: labels ? labels.split(',').map((l: string) => l.trim()) : undefined,
        topK: topK,
        model: selectedModel || undefined,
        conversationId: currentConvId || undefined,
        ragBypass: ragBypass || undefined,
      };

      const endpoint = ragBypass ? '/llm/query' : '/rag/query';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(query),
        signal: controller.signal
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const result: { answer: string; citations: Array<{
        pageId: string;
        title: string;
        url: string;
        sectionAnchor?: string;
        snippet?: string;
      }>; displayCitations?: Array<{
        pageId: string;
        title: string;
        url: string;
        sectionAnchor?: string;
        snippet?: string;
      }>; citationIndexMap?: number[] } = await response.json();

      const split = splitThinking(result.answer);
      const assistantMessage: Message = {
        id: assistantMessageId,
        type: 'assistant',
        content: split.answer || deriveAnswerFromThinking(split.thinking),
        thinking: split.thinking,
        citations: result.citations,
        displayCitations: result.displayCitations,
        citationIndexMap: result.citationIndexMap
      };

      addMessage(currentConvId || activeId || '', assistantMessage);
      setAnimatingMessageId(assistantMessageId);

      // Title generation after streaming completes
      updateConversationTitle(currentConvId || activeId || '', selectedModel);

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
      };
      addMessage(currentConvId || activeId || '', errorMessage);
    } finally {
      setAbortController(null);
      setIsLoading(false);
      setInput('');
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  };

  return (
    <div className="app">
      <div className="workspace">
        <header className="workspace-header">
          <div className="header-content">
            <div className="header-title">
              <h1>Cabin</h1>
              {!isOnline && (
                <div className="connection-status offline" title={`Offline: ${connectionError}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 14V2"/>
                    <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.53l2.5-8A2 2 0 0 1 6.66 2H17"/>
                    <path d="M13 8h8"/>
                  </svg>
                  <span>Offline</span>
                </div>
              )}
            </div>
            <div className="header-actions">
              <button
                type="button"
                className="header-button"
                title="Settings"
                onClick={() => setSettingsOpen(true)}
                aria-label="Open settings"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.07a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
              <button
                type="button"
                className="header-button"
                title="Toggle theme"
                onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
                aria-label="Toggle theme"
              >
                {theme === 'light' ? (
                  // Moon icon
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                ) : (
                  // Sun icon
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <circle cx="12" cy="12" r="4"/>
                    <path d="M12 2v2m0 16v2m10-10h-2M4 12H2m15.364-7.364-1.414 1.414M8.05 16.95l-1.414 1.414m0-13.728L8.05 6.05m9.9 9.9 1.414 1.414"/>
                  </svg>
                )}
              </button>
              {current && current.messages.length > 0 && (
                <div className="export-dropdown" ref={exportDropdownRef}>
                  <button
                    className="header-button"
                    onClick={() => setExportDropdownOpen(!exportDropdownOpen)}
                    title="Export conversation"
                    aria-label="Export conversation"
                    aria-expanded={exportDropdownOpen}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7,10 12,15 17,10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden style={{ marginLeft: '4px' }}>
                      <polyline points="6,9 12,15 18,9"/>
                    </svg>
                  </button>
                  {exportDropdownOpen && (
                    <div className="export-dropdown-menu">
                      <button
                        className="export-option"
                        onClick={() => {
                          exportConversation('markdown');
                          setExportDropdownOpen(false);
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14,2 14,8 20,8"/>
                        </svg>
                        Export as Markdown
                      </button>
                      <button
                        className="export-option"
                        onClick={() => {
                          exportConversation('json');
                          setExportDropdownOpen(false);
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14,2 14,8 20,8"/>
                          <line x1="16" y1="13" x2="8" y2="13"/>
                          <line x1="16" y1="17" x2="8" y2="17"/>
                          <polyline points="10,9 9,9 8,9"/>
                        </svg>
                        Export as JSON
                      </button>
                    </div>
                  )}
                </div>
              )}
              {/* New conversation button moved to HistoryPane header */}
            </div>
          </div>
        </header>

        <div className="workarea">
          <HistoryPane
            items={conversations.map<HistoryConversation>(c => ({ 
              id: c.id, 
              title: c.title || 'Untitled', 
              updatedAt: c.updatedAt,
              generatingTitle: c.generatingTitle,
              pinned: c.pinned,
              messages: c.messages
            }))}
            activeId={current?.id || null}
            onSelect={(id) => setActiveId(id)}
            onNew={createConversation}
            onDelete={deleteConversation}
            onRename={renameConversation}
            onTogglePin={togglePinConversation}
            onDeleteAll={deleteAllConversations}
            onDeleteAllRequest={openDeleteAllModal}
          />
          <div className="main-pane">
            <div className="conversation">
              {/* No welcome box; keep area clean when empty */}
              
          {(current?.messages || []).map((message, index) => {
            if (message.type === 'user') {
              return (
                <div key={message.id} className={`message message-${message.type}`}>
                  <div className="message-content">{message.content}</div>
                </div>
              );
            }

            const thinking = message.thinking || '';
            let visibleAnswer = (message.content || '').trim();
            if (!visibleAnswer && thinking) {
              const derived = deriveAnswerFromThinking(thinking);
              if (derived && derived.trim()) {
                visibleAnswer = derived.trim();
              }
            }
            
            // Debug logging for LLM responses (only in development)
            if (process.env.NODE_ENV === 'development' && thinking && !visibleAnswer) {
              console.log('Debug: LLM response with thinking but no answer derived');
              console.log('Original content length:', (message.content || '').length);
              console.log('Thinking length:', thinking.length);
              console.log('Derived answer length:', deriveAnswerFromThinking(thinking).length);
            }
            const prevQuery = index > 0 ? (current?.messages[index - 1]?.content || '') : '';
            const animate = animatingMessageId === message.id;

            return (
              <div key={message.id} className={`message message-${message.type}`}>
                {thinking && (
                  <div className="thinking-disclosure">
                    <button
                      type="button"
                      className="thinking-toggle"
                      aria-expanded={!!thinkingOpen[message.id]}
                      aria-controls={`thinking-${message.id}`}
                      onClick={() => toggleThinking(message.id)}
                    >
                      <span className="chevron" aria-hidden>{thinkingOpen[message.id] ? '▾' : '▸'}</span>
                      <span className="thinking-label">{thinkingOpen[message.id] ? 'Hide thinking' : 'Show thinking'}</span>
                    </button>
                    {thinkingOpen[message.id] && (
                      <div id={`thinking-${message.id}`} className="message-content thinking-block" aria-label="Model thinking">
                        <div className="thinking-header">Thinking</div>
                        <pre className="thinking-text">{thinking}</pre>
                      </div>
                    )}
                  </div>
                )}
                <SmartResponse
                  answer={visibleAnswer}
                  citations={message.citations || []}
                  displayCitations={message.displayCitations}
                  citationIndexMap={message.citationIndexMap}
                  query={prevQuery}
                  animate={animate}
                />
              </div>
            );
          })}
          
          {isLoading && (
            <div className="message message-assistant">
              <div className="message-content loading">
                <LoadingProgress
                  query={input.trim()}
                  space={space || undefined}
                  labels={labels ? labels.split(',').map(l => l.trim()).filter(Boolean) : []}
                  isLLMMode={ragBypass}
                />
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSubmit} className="input-area">
              <div className="input-left-controls">
                <label className="rag-bypass-toggle">
                  <input
                    type="checkbox"
                    checked={ragBypass}
                    onChange={(e) => setRagBypass(e.target.checked)}
                    className="toggle-checkbox"
                  />
                  <span className="toggle-label" title={ragBypass ? 'Direct LLM responses' : 'Document-grounded answers'}>
                    <div className="toggle-switch">
                      <div className="toggle-slider"></div>
                    </div>
                    <span className="mode-text">{ragBypass ? 'LLM' : 'RAG'}</span>
                  </span>
                </label>
              </div>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={!isOnline ? "Offline - check connection..." : "Ask a question..."}
                className="input-field"
                disabled={isLoading || !isOnline}
                autoFocus
              />
              {isLoading ? (
                <button 
                  type="button" 
                  className="stop-button"
                  onClick={stopGeneration}
                >
                  Stop
                </button>
              ) : (
                <button 
                  type="submit" 
                  className="send-button"
                  disabled={!input.trim() || !isOnline}
                  title={!isOnline ? "Cannot send while offline" : undefined}
                >
                  Send
                </button>
              )}
            </form>
          </div>
        </div>
      </div>

      <SettingsDrawer
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        space={space}
        setSpace={setSpace}
        labels={labels}
        setLabels={setLabels}
        topK={topK}
        setTopK={setTopK}
        temperature={temperature}
        setTemperature={setTemperature}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        availableModels={availableModels}
        ragConfig={ragConfig}
        setRagConfig={setRagConfig}
        crawlerAllSpaces={crawlerAllSpaces}
        setCrawlerAllSpaces={setCrawlerAllSpaces}
        crawlerSpaces={crawlerSpaces}
        setCrawlerSpaces={setCrawlerSpaces}
        crawlerPageSize={crawlerPageSize}
        setCrawlerPageSize={setCrawlerPageSize}
        crawlerMaxPages={crawlerMaxPages}
        setCrawlerMaxPages={setCrawlerMaxPages}
        crawlerConcurrency={crawlerConcurrency}
        setCrawlerConcurrency={setCrawlerConcurrency}
        availableSpaces={availableSpaces}
        refreshSpaces={refreshSpaces}
        saveCrawlerConfig={saveCrawlerConfig}
        triggerSync={triggerSync}
        saveRagConfig={saveRagConfig}
      />

      {notification && (
        <NotificationToast
          message={notification.message}
          type={notification.type}
        />
      )}

      <DeleteAllModal
        isOpen={deleteAllOpen}
        onClose={() => setDeleteAllOpen(false)}
        onConfirm={deleteAllConversations}
        conversationCount={conversations.length}
      />
    </div>
  );
}

export default App;
