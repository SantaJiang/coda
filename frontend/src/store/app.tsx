import { createEffect, onCleanup, onMount, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import * as api from "../lib/api"
import { subscribeEvents } from "../lib/events"
import {
  loadConfiguredModels,
  loadPinnedModelKeys,
  loadSelectedModelKey,
  mergeSelectables,
  resolveSelectedKey,
  toBackendPatch,
} from "../lib/models"
import {
  createLocalProject,
  ensureLocalProject,
  hydrateProjects,
  isLocalProject,
  loadLastProject,
  loadProjects,
  pickSelectedProjectId,
  resolveHomeDir,
  saveLastProject,
  saveProjects,
  saveProjectSessions,
} from "../lib/persist"
import { applyClientEvent } from "./apply-event"
import { createChromeSlice } from "./chrome-slice"
import { StoreProviders } from "./ctx"
import { reportError, type StoreHandle } from "./handle"
import { persistSelection, createModelSlice } from "./model-slice"
import type { AppPorts } from "./ports"
import { createProjectSlice } from "./project-slice"
import { createRuntimeSlice } from "./runtime-slice"
import { initialState, type AppState, type QueuedMessage } from "./state"

export type { AppState, ConnectionState, QueuedMessage } from "./state"
export type { AppPorts } from "./ports"
export { useChrome, useModels, useProjects, useRuntime } from "./ctx"

const defaultPorts: AppPorts = {
  client: api,
  subscribe: subscribeEvents,
}

export function AppProvider(props: ParentProps<{ ports?: Partial<AppPorts> }>) {
  const client = props.ports?.client ?? defaultPorts.client
  const subscribe = props.ports?.subscribe ?? defaultPorts.subscribe
  const [state, setState] = createStore<AppState>(initialState)
  const handle: StoreHandle = { state, setState, client }
  const skipQueueFlush: Record<string, boolean> = {}
  const sendAfterIdle: Record<string, QueuedMessage | undefined> = {}

  const projects = createProjectSlice(handle)
  const models = createModelSlice(handle)
  const runtime = createRuntimeSlice(handle, { skipQueueFlush, sendAfterIdle, flushing: {} })
  const chrome = createChromeSlice(handle)

  let lastSseConnected: boolean | null = null
  let bootstrapped = false
  let bootstrapping: Promise<void> | null = null
  const resyncAfterReconnect = async () => {
    const project = projects.selectedProject()
    if (project) await projects.refreshProjectSessions(project).catch(() => undefined)
    const session = projects.selectedSession()
    if (session) await projects.resyncSession(session).catch(() => undefined)
  }
  const applySseConnection = (ok: boolean) => {
    setState("connection", ok ? "connected" : "disconnected")
    if (ok && lastSseConnected === false) void resyncAfterReconnect()
    lastSseConnected = ok
  }
  const bootstrapBackend = () => {
    if (bootstrapped) return Promise.resolve()
    if (bootstrapping) return bootstrapping
    bootstrapping = (async () => {
      const ok = await client.healthcheck().catch(() => false)
      if (!ok) return
      bootstrapped = true
      const patch = toBackendPatch(loadConfiguredModels(), loadSelectedModelKey())
      if (patch) await client.patchGlobalConfig(patch).catch(() => undefined)
      const backendProjects = await client.listProjects().catch(() => [])
      if (backendProjects.length) await projects.restoreProjects(backendProjects)
      await models.refreshDiscovered()
    })().finally(() => {
      bootstrapping = null
    })
    return bootstrapping
  }

  onMount(() => {
    const stored = loadProjects()
    const last = loadLastProject()
    const initial = hydrateProjects(stored)
    const configured = loadConfiguredModels()
    const selectedId = pickSelectedProjectId(initial, last)
    setState("projects", initial)
    setState("selectedProjectId", selectedId)
    if (selectedId && selectedId !== last) saveLastProject(selectedId)
    setState("draft", true)
    setState("configuredModels", configured)
    setState("pinnedModelKeys", loadPinnedModelKeys())
    persistSelection(handle, resolveSelectedKey(configured, mergeSelectables(configured, []), loadSelectedModelKey()))

    for (const project of initial) {
      void projects.hydrateProjectPath(project)
    }

    void resolveHomeDir().then((home) => {
      if (!home) return
      let nextSelected: string | null = null
      setState(
        produce((draft) => {
          draft.projects = ensureLocalProject(draft.projects, home)
          if (!draft.selectedProjectId || !draft.projects.some((project) => project.id === draft.selectedProjectId)) {
            draft.selectedProjectId = pickSelectedProjectId(draft.projects, last)
          }
          nextSelected = draft.selectedProjectId
        }),
      )
      if (nextSelected) saveLastProject(nextSelected)
      void projects.refreshProjectSessions(createLocalProject(home))
    })

    const ping = window.setInterval(() => {
      if (bootstrapped) {
        window.clearInterval(ping)
        return
      }
      void bootstrapBackend()
    }, 8000)

    void bootstrapBackend()

    const stop = subscribe(
      (parsed) => {
        const autoReplies: ReturnType<typeof applyClientEvent>["autoReplies"] = []
        const idleSessions: string[] = []
        setState(
          produce((draft) => {
            const effects = applyClientEvent(draft, parsed)
            autoReplies.push(...effects.autoReplies)
            idleSessions.push(...effects.idleSessions)
          }),
        )
        for (const item of autoReplies) {
          void client.replyPermission(item.directory, item.id, item.reply).catch((error) => {
            setState(
              produce((draft) => {
                draft.permissions[item.id] = item.permission
              }),
            )
            reportError(handle, error, "自动授权失败")
          })
        }
        for (const sessionID of new Set(idleSessions)) {
          void runtime.flushQueue(sessionID)
        }
      },
      (connected) => {
        applySseConnection(connected)
        if (!connected) return
        if (bootstrapped) void models.refreshDiscovered()
        else void bootstrapBackend()
      },
    )

    onCleanup(() => {
      stop()
      window.clearInterval(ping)
    })
  })

  createEffect(() => {
    saveProjects(state.projects)
  })

  createEffect(() => {
    for (const project of state.projects) {
      if (isLocalProject(project)) continue
      const list = state.sessionsByProject[project.path]
      if (!list) continue
      saveProjectSessions(project.id, list)
    }
  })

  createEffect(() => {
    const selected = state.selectedVariant
    if (!selected) return
    if (!models.currentVariants().includes(selected)) setState("selectedVariant", null)
  })

  createEffect((prev?: string | null) => {
    const id = state.selectedSessionId
    if (prev !== undefined && id !== prev) setState("planPanelDismissed", false)
    return id
  })

  createEffect(() => {
    const project = projects.selectedProject()
    if (!project || isLocalProject(project) || project.missing) {
      setState("vcsBranch", "")
      return
    }
    let cancelled = false
    void client
      .getVcs(project.path)
      .then((info) => {
        if (!cancelled) setState("vcsBranch", info?.branch ?? "")
      })
      .catch(() => {
        if (!cancelled) setState("vcsBranch", "")
      })
    onCleanup(() => {
      cancelled = true
    })
  })

  return (
    <StoreProviders projects={projects} models={models} runtime={runtime} chrome={chrome}>
      {props.children}
    </StoreProviders>
  )
}
