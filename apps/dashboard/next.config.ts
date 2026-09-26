import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone output bundles everything needed to run `node .next/standalone/server.js`
  // without installing node_modules — used by the Homebrew / curl installer
  output: "standalone",
};

export default nextConfig;
