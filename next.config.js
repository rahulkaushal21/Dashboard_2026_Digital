/** @type {import('next').NextConfig} */
// Set DEPLOY_TARGET=github for a static export (GitHub Pages).
// Leave unset (or =vercel) for a normal Vercel deploy.
const isGithub = process.env.DEPLOY_TARGET === 'github'
const repo = 'Dashboard_2026_Digital'

const nextConfig = {
  reactStrictMode: true,
  ...(isGithub
    ? {
        output: 'export',
        basePath: `/${repo}`,
        assetPrefix: `/${repo}/`,
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {}),
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
}
module.exports = nextConfig
