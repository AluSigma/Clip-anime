/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.ytimg.com',
      },
      {
        protocol: 'https',
        hostname: '**.ggpht.com',
      },
    ],
  },
  experimental: {
    serverComponentsExternalPackages: ['fluent-ffmpeg'],
  },
};

export default nextConfig;
