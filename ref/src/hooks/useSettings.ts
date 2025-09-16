import React, { useState } from 'react';

export interface RagConfig {
  useOptimizedPipeline: boolean;
  useSmartPipeline: boolean;
  relevanceThreshold: number;
  adaptiveThreshold: boolean;
  mmrLambda: number;
  maxVectorCandidates: number;
  minVectorResults: number;
  mmrPoolMultiplier: number;
  embedIncludeTitle: boolean;
  embedTitleWeight: number;
  embedIncludeLabels: boolean;
  embedIncludeAnchor: boolean;
  enableIntentProcessing: boolean;
  maxFallbackQueries: number;
  intentConfidenceThreshold: number;
  chunkTtlDays: number;
  minKeywordScore: number;
  preferLiveSearch: boolean;
}

export function useSettings() {
  const [space, setSpace] = useState<string>(() => (typeof window !== 'undefined' ? localStorage.getItem('chat:space:v1') || '' : ''));
  const [labels, setLabels] = useState<string>(() => (typeof window !== 'undefined' ? localStorage.getItem('chat:labels:v1') || '' : ''));
  const [topK, setTopK] = useState(() => (typeof window !== 'undefined' ? Number(localStorage.getItem('settings:topK')) || 5 : 5));
  const [temperature, setTemperature] = useState(() => (typeof window !== 'undefined' ? Number(localStorage.getItem('settings:temperature')) || 0.7 : 0.7));
  const [ragBypass, setRagBypass] = useState(() => (typeof window !== 'undefined' ? localStorage.getItem('settings:ragBypass') === 'true' : false));
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('theme') : null;
    if (saved === 'light' || saved === 'dark') return saved;
    const prefersLight = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    return prefersLight ? 'light' : 'dark';
  });

  const [ragConfig, setRagConfig] = useState<RagConfig>({
    useOptimizedPipeline: true,
    useSmartPipeline: true,
    relevanceThreshold: 0.05,
    adaptiveThreshold: false,
    mmrLambda: 0.7,
    maxVectorCandidates: 50,
    minVectorResults: 3,
    mmrPoolMultiplier: 5,
    embedIncludeTitle: true,
    embedTitleWeight: 2,
    embedIncludeLabels: false,
    embedIncludeAnchor: false,
    enableIntentProcessing: true,
    maxFallbackQueries: 3,
    intentConfidenceThreshold: 0.7,
    chunkTtlDays: 7,
    minKeywordScore: 0.0,
    preferLiveSearch: false
  });

  // Persist settings
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('chat:space:v1', space);
  }, [space]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('chat:labels:v1', labels);
  }, [labels]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('settings:topK', String(topK));
  }, [topK]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('settings:temperature', String(temperature));
  }, [temperature]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('settings:ragBypass', String(ragBypass));
  }, [ragBypass]);

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  return {
    space, setSpace,
    labels, setLabels,
    topK, setTopK,
    temperature, setTemperature,
    ragBypass, setRagBypass,
    theme, setTheme,
    ragConfig, setRagConfig
  };
}