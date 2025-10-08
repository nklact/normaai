import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // Build configuration
  build: {
    emptyOutDir: true, // Force empty dist on build
    rollupOptions: {
      // Dynamic imports handle platform-specific APIs, so no external configuration needed
    }
  },
  define: {
    // Define build target for conditional compilation
    __TAURI_BUILD__: JSON.stringify(!!process.env.TAURI_ENV_PLATFORM),
    __CAPACITOR_BUILD__: JSON.stringify(!!process.env.CAPACITOR_PLATFORM),
    __WEB_BUILD__: JSON.stringify(!process.env.TAURI_ENV_PLATFORM && !process.env.CAPACITOR_PLATFORM)
  }
}));
