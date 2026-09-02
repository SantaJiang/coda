import { defineConfig, type Plugin } from "vite"
import solid from "vite-plugin-solid"
import uno from "unocss/vite"

const host = process.env.TAURI_DEV_HOST

function codaModelsProxy(): Plugin {
  return {
    name: "coda-models-proxy",
    configureServer(server) {
      server.middlewares.use("/__coda/models", (req, res, next) => {
        if (req.method !== "POST") {
          next()
          return
        }
        const chunks: Buffer[] = []
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        req.on("end", () => {
          void (async () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as { url?: string; apiKey?: string }
              const url = typeof body.url === "string" ? body.url.trim() : ""
              if (!/^https?:\/\//i.test(url)) {
                res.statusCode = 400
                res.setHeader("Content-Type", "application/json")
                res.end(JSON.stringify({ message: "接口地址无效" }))
                return
              }
              const upstream = await fetch(url, {
                method: "GET",
                headers: {
                  Authorization: `Bearer ${body.apiKey ?? ""}`,
                  "x-api-key": String(body.apiKey ?? ""),
                  "anthropic-version": "2023-06-01",
                },
              })
              const text = await upstream.text()
              res.statusCode = upstream.status
              res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json")
              res.end(text)
            } catch (error) {
              res.statusCode = 502
              res.setHeader("Content-Type", "application/json")
              res.end(JSON.stringify({ message: error instanceof Error ? error.message : "获取模型列表失败" }))
            }
          })()
        })
      })
    },
  }
}

export default defineConfig(async () => ({
  plugins: [uno(), solid(), codaModelsProxy()],
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
