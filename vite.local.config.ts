import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "local",
  base: "/",
  envDir: false,
  publicDir: "../public",
  plugins: [react()],
  build: { outDir: "../.local-dist", emptyOutDir: true },
  server: { host: "127.0.0.1", strictPort: true },
});
