import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const localWebViewHTML = {
  name: "local-webview-html",
  apply: "build" as const,
  transformIndexHtml: {
    order: "post" as const,
    handler(html: string) {
      return html
        .replace(/<script type="module" crossorigin/g, "<script defer")
        .replace(/<script type="module"/g, "<script defer")
        .replace(/ rel="stylesheet" crossorigin/g, " rel=\"stylesheet\"");
    },
  },
};

export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [react(), localWebViewHTML],
  define: { "import.meta": "{}" },
  build: {
    outDir: resolve(__dirname, "../GooseNotes/Resources/Web"),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 2100,
    modulePreload: false,
    rollupOptions: {
      input: resolve(__dirname, "index.html"),
      output: {
        format: "iife",
        entryFileNames: "assets/editor.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  },
  server: {
    strictPort: true,
    fs: { strict: true }
  }
});
