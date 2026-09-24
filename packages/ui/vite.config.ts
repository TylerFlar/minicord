import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  // Relative asset paths so the build loads from Electron's custom protocol and Capacitor alike.
  base: "./",
  plugins: [react(), tailwindcss()],
  define: { __MINICORD_VERSION__: JSON.stringify(version) },
  server: { port: 5174, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true, target: "es2023" },
});
