/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  images: { unoptimized: true },
  experimental: {
    cpus: 2,
    // Next 14 does not trace Prisma's JavaScript compiler WASM automatically.
    // Include the generated client assets in every serverless function bundle.
    outputFileTracingIncludes: {
      "/*": [
        "./node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/**/*",
      ],
    },
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
