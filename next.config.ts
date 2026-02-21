import type { NextConfig } from "next";

const blobPublicHost = process.env.BLOB_PUBLIC_HOST?.trim().toLowerCase();

if (!blobPublicHost) {
  throw new Error("Missing BLOB_PUBLIC_HOST. Set it to your Vercel Blob hostname (for example: <store-id>.public.blob.vercel-storage.com).");
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: blobPublicHost,
      },
    ],
  },
};

export default nextConfig;
