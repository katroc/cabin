/** @type {import('tailwindcss').Config} */
module.exports = {
  // Scan all typical Next.js source folders in this package
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // Use media-based dark mode to match existing dark: classes
  darkMode: 'media',
  theme: {
    extend: {},
  },
  // Ensure critical utilities are always available, even if scanning misses them
  safelist: [
    // Colors and backgrounds
    'bg-blue-500', 'hover:bg-blue-600', 'bg-white', 'bg-gray-50',
    'text-white', 'text-gray-900', 'text-gray-500', 'text-gray-400', 'text-blue-500',
    // Borders and radii
    'border', 'border-b', 'border-r', 'border-gray-200', 'border-gray-300', 'border-blue-200', 'rounded', 'rounded-lg',
    // Layout and spacing
    'h-screen', 'w-full', 'w-80', 'flex', 'flex-1', 'flex-col', 'items-center', 'items-start', 'justify-between',
    'space-x-1', 'space-x-2', 'space-y-4', 'overflow-y-auto', 'p-1', 'p-2', 'p-3', 'p-4', 'px-4', 'py-2', 'pl-10', 'pr-4',
    // States
    'focus:outline-none', 'focus:ring-2', 'focus:ring-blue-500',
    // Dark variants (media-based)
    'dark:bg-gray-700', 'dark:bg-gray-800', 'dark:bg-gray-900', 'dark:text-white', 'dark:text-gray-400',
    'dark:border-gray-600', 'dark:border-gray-700', 'dark:hover:bg-gray-600', 'dark:hover:bg-gray-700',
  ],
  plugins: [],
}
