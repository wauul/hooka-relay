/** @type {import('next').NextConfig} */
const config = { poweredByHeader: false, images: { unoptimized: true }, experimental: { cpus: 2 }, async headers() { return [{ source: '/(.*)', headers: [{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'same-origin'},{key:'X-Frame-Options',value:'DENY'}] }]; } };
export default config;
