/** @type {import('next').NextConfig} */
// Set DEPLOY_TARGET=github for a static export (GitHub Pages).
// Leave unset (or =vercel) for a normal Vercel deploy.
//
// The GitHub Pages site lives on a custom domain (public/CNAME), which serves
// the export from the domain root. Without a custom domain a project site sits
// under /<repo>/, so set PAGES_CUSTOM_DOMAIN= (empty) to bring the prefix back.
const isGithub = process.env.DEPLOY_TARGET === 'github'
const repo = 'Dashboard_2026_Digital'
const customDomain = process.env.PAGES_CUSTOM_DOMAIN ?? 'webdashboard.mavlers.io'
const prefix = customDomain ? '' : `/${repo}`

const nextConfig = {
  reactStrictMode: true,
  ...(isGithub
    ? {
        output: 'export',
        ...(prefix ? { basePath: prefix, assetPrefix: `${prefix}/` } : {}),
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {}),
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
}
module.exports = nextConfig
