import { withSentryConfig } from "@sentry/nextjs/config";
const release = process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA;
/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_SENTRY_RELEASE: release || "",
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || "development",
  },
  serverExternalPackages: ["@xenova/transformers", "onnxruntime-node", "sharp"],
  outputFileTracingExcludes: { "/api/support-chat": ["**/onnxruntime-node/bin/napi-v3/darwin/**", "**/onnxruntime-node/bin/napi-v3/win32/**", "**/onnxruntime-node/bin/napi-v3/linux/arm64/**"] },
  images: { unoptimized: true },
  experimental: {
    cpus: 2,
    serverSourceMaps: !!process.env.SENTRY_AUTH_TOKEN,
  },
    // Include Prisma compiler WASM in serverless bundles.
    // Include the generated client assets in every serverless function bundle.
    outputFileTracingIncludes: {
      "/*": [
        "./node_modules/.prisma/client/**/*",
        "./node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/**/*",
      ],
    },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default withSentryConfig(config, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_WEB_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
  release: { name: release },
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN, deleteSourcemapsAfterUpload: true },
  webpack: { autoInstrumentServerFunctions: true, autoInstrumentAppDirectory: true, autoInstrumentMiddleware: true, treeshake: { removeDebugLogging: true } },
});

