import { useState, useEffect } from 'react';

export function useModels() {
  const [availableModels, setAvailableModels] = useState<Array<{id: string, object: string}>>([]);
  const [selectedModel, setSelectedModel] = useState<string>(() => (typeof window !== 'undefined' ? localStorage.getItem('chat:model:v1') || '' : ''));

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch('/models');
        if (response.ok) {
          const data = await response.json();
          setAvailableModels(data.data || []);
          // Set first model as default if none selected
          if (!selectedModel && data.data?.length > 0) {
            setSelectedModel(data.data[0].id);
          }
        }
      } catch (error) {
        console.error('Failed to fetch models:', error);
      }
    };

    fetchModels();
  }, [selectedModel]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (selectedModel) localStorage.setItem('chat:model:v1', selectedModel);
  }, [selectedModel]);

  return {
    availableModels,
    selectedModel,
    setSelectedModel
  };
}