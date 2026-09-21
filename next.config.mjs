/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  serverExternalPackages: ["@xenova/transformers", "onnxruntime-node", "sharp"],
  outputFileTracingExcludes: { "/api/support-chat": ["**/onnxruntime-node/bin/napi-v3/darwin/**", "**/onnxruntime-node/bin/napi-v3/win32/**", "**/onnxruntime-node/bin/napi-v3/linux/arm64/**"] },
  images: { unoptimized: true },
  experimental: {
    cpus: 2,
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
export default config;

