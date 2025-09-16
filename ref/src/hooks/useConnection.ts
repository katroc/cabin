import { useState, useEffect } from 'react';

export function useConnection() {
  const [isOnline, setIsOnline] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const checkHealth = async () => {
    try {
      const response = await fetch('/health', { cache: 'no-cache' });
      if (response.ok) {
        setIsOnline(true);
        setConnectionError(null);
        return true;
      } else {
        setIsOnline(false);
        setConnectionError(`Server error: ${response.status}`);
        return false;
      }
    } catch (error) {
      setIsOnline(false);
      setConnectionError(error instanceof Error ? error.message : 'Connection failed');
      return false;
    }
  };

  useEffect(() => {
    // Check health every 30 seconds
    const healthInterval = setInterval(checkHealth, 30000);
    return () => clearInterval(healthInterval);
  }, []);

  return {
    isOnline,
    connectionError,
    checkHealth
  };
}