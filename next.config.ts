import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Pin the Turbopack root to this repo. Without it Next walks up and finds the stray
  // `package-lock.json` in the home directory, then warns that it is outside the Git repo.
  turbopack: {
    root: __dirname,
  },
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
