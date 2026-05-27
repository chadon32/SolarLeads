import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    optimizePackageImports: [
      "@react-three/drei",
      "@react-three/fiber",
      "three",
      "@supabase/supabase-js",
      "resend",
    ],
  },
};

export default nextConfig;
