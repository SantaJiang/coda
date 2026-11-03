import { expect, it, vi } from "vitest"
import { render } from "solid-js/web"
import { StoreProviders } from "../store/ctx"
import type { ChromeApi, ModelApi, ProjectApi, RuntimeApi } from "../store/contracts"
import { McpSettings } from "./McpSettings"

const api = vi.hoisted(() => ({
  listMcp: vi.fn(),
  getGlobalConfig: vi.fn(),
  saveMcpServer: vi.fn(),
  connectMcp: vi.fn(),
  disconnectMcp: vi.fn(),
  removeMcp: vi.fn(),
  authenticateMcp: vi.fn(),
  fetchHomeDir: vi.fn(),
}))

vi.mock("../lib/api", () => api)

it("lists a server and disconnects it from the switch", async () => {
  api.listMcp.mockResolvedValue({ demo: { status: "connected" } })
  api.getGlobalConfig.mockResolvedValue({ mcp: { demo: { type: "local", command: ["echo", "demo"] } } })
  api.disconnectMcp.mockResolvedValue(true)
  const chrome = {
    mcpSettingsOpen: () => true,
    closeMcpSettings: vi.fn(),
  } as unknown as ChromeApi
  const projects = {
    selectedProject: () => ({ id: "p", path: "/tmp/proj", name: "proj", expanded: true }),
  } as unknown as ProjectApi
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(
    () => (
      <StoreProviders projects={projects} models={{} as ModelApi} runtime={{} as RuntimeApi} chrome={chrome}>
        <McpSettings />
      </StoreProviders>
    ),
    container,
  )
  try {
    await vi.waitFor(() => expect(container.textContent).toContain("已连接"))
    expect(container.textContent).toContain("echo demo")
    container.querySelector<HTMLButtonElement>("[aria-label='停用 demo']")!.click()
    await vi.waitFor(() => expect(api.disconnectMcp).toHaveBeenCalledWith("/tmp/proj", "demo"))
  } finally {
    dispose()
    container.remove()
  }
})
