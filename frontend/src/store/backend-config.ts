import { toBackendPatch } from "../lib/models"
import type { AppState } from "./state"
import type { AgentClient } from "./ports"

type ConfigSyncDependencies = {
  state: Pick<AppState, "configuredModels" | "selectedModelKey">
  client: Pick<AgentClient, "patchGlobalConfig">
}

/** Serialize configuration writes and converge on the newest locally saved settings. */
export function createBackendConfigSync(
  handle: ConfigSyncDependencies,
  onError: (message: string | null) => void = () => {},
) {
  let applied: string | undefined
  let epoch = 0
  let pending: Promise<void> | undefined
  const sync = (): Promise<void> => {
    if (pending) return pending
    pending = (async () => {
      while (true) {
        // Requests carry their model explicitly. Changing the composer selection must
        // not rewrite global config and tear down sessions already using that config.
        const configured = toBackendPatch(handle.state.configuredModels, null)
        const patch = configured ? { provider: configured.provider } : null
        const key = JSON.stringify(patch)
        if (key === applied) {
          onError(null)
          return
        }
        const started = epoch
        if (patch) await handle.client.patchGlobalConfig(patch)
        if (started === epoch) applied = key
      }
    })()
      .catch((error) => {
        onError(error instanceof Error ? error.message : "模型配置同步失败")
        throw error
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }
  return {
    sync,
    invalidate: () => {
      epoch += 1
      applied = undefined
    },
  }
}

export function createBackendBootstrap(input: {
  healthcheck: () => Promise<boolean>
  initialize: () => Promise<void>
  onError: (error: unknown) => void
  onReady?: () => void
}) {
  let ready = false
  let pending: Promise<boolean> | undefined
  let epoch = 0
  const ensure = (): Promise<boolean> => {
    if (ready) return Promise.resolve(true)
    if (pending) return pending
    const started = epoch
    pending = (async () => {
      if (!(await input.healthcheck())) return false
      await input.initialize()
      ready = started === epoch
      if (ready) input.onReady?.()
      return ready
    })()
      .catch((error) => {
        if (started === epoch) input.onError(error)
        return false
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }
  return {
    ensure,
    invalidate: () => {
      epoch += 1
      ready = false
    },
  }
}
