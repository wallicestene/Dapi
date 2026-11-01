import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page reads live job folders, so nothing is prerendered or cached (Cache
  // Components stays off). The pipeline in ../src is loaded at run time, not bundled,
  // so the root stays this folder and Turbopack never watches jobs/ or storage/.
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
