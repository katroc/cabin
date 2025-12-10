/** @type {import('next').NextConfig} */
const nextConfig = {
    async rewrites() {
        // In production (when accessed via Cloudflare tunnel), proxy API requests to the backend
        // The backend URL can be configured via environment variable
        const backendUrl = process.env.BACKEND_URL || 'http://localhost:8788';

        return [
            {
                source: '/api/:path*',
                destination: `${backendUrl}/api/:path*`,
            },
        ];
    },
}

module.exports = nextConfig
