import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `--mode single` inlines everything into one HTML file (for the claude.ai artifact).
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [preact(), ...(mode === "single" ? [viteSingleFile()] : [])],
  build: { outDir: mode === "single" ? "dist-single" : "dist" },
  test: { environment: "node" },
}));
