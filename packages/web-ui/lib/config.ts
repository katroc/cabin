/**
 * Application Configuration
 */

// API Base URL
// Defaults to localhost:8788 for local development
// Can be overridden by NEXT_PUBLIC_API_URL environment variable
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8788';
console.log('API_BASE_URL:', API_BASE_URL);

/**
 * Helper to construct full API URLs
 * @param path - Relative path (e.g., '/api/chat')
 * @returns Full URL (e.g., 'http://localhost:8788/api/chat')
 */
export const getApiUrl = (path: string): string => {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE_URL}${cleanPath}`;
};
