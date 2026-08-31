import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import uno from "unocss/vite"

const host = process.env.TAURI_DEV_HOST

export default defineConfig(async () => ({
  plugins: [uno(), solid()],
  clearScreen: false,
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
      ignored: ["**/src-tauri/**"],
    },
  },
}))
