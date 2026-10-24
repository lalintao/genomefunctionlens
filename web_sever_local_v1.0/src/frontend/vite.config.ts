import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const backendTarget = process.env.VITE_BACKEND_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@frontend": fileURLToPath(new URL("./src", import.meta.url)),
      "fake-indexeddb": fileURLToPath(new URL("./node_modules/fake-indexeddb/build/esm/index.js", import.meta.url)),
    },
  },
  test: {
    include: ["../../test/frontend/**/*.test.{ts,tsx}"],
    alias: [
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: fileURLToPath(new URL("./node_modules/react/jsx-dev-runtime.js", import.meta.url)),
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: fileURLToPath(new URL("./node_modules/react/jsx-runtime.js", import.meta.url)),
      },
      {
        find: /^react-dom\/server$/,
        replacement: fileURLToPath(new URL("./node_modules/react-dom/server.node.js", import.meta.url)),
      },
    ],
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        privacy: "privacy.html",
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
      },
      "/downloads": {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
});
