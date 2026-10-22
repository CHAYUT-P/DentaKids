import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // the VPS image (deploy/Dockerfile) runs the self-contained server build;
  // Vercel builds without it
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // the floating dev badge sits on top of the phone mockups
  devIndicators: false,
  // patient photos and X-rays go up through server actions (Vercel caps a
  // request at 4.5 MB; the page shrinks photos before sending)
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  // basic browser protections for pages holding children's names and parents'
  // phone numbers: no framing (clickjacking), no MIME guessing, no full URLs
  // leaked to other sites, HTTPS only once seen over HTTPS
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
};

export default nextConfig;
