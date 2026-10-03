import { createEffect, onCleanup, onMount, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import * as api from "../lib/api"
import { subscribeEvents } from "../lib/events"
import {
  loadConfiguredModels,
  loadSelectedModelKey,
  menuDiscoveredModels,
  mergeSelectables,
  resolveSelectedKey,
  toBackendPatch,
} from "../lib/models"
import { flushShared, onSharedChange, type SharedSettings } from "../lib/shared"
import { newestDraft } from "../lib/draft-session"
import {
  createLocalProject,
  ensureLocalProject,
  hydrateProjects,
  isLocalProject,
  loadDraftSessions,
  loadLastProject,
  loadProjects,
  pickSelectedProjectId,
  resolveHomeDir,
  samePath,
  saveLastProject,
  saveProjects,
  saveProjectSessions,
} from "../lib/persist"
import { applyClientEvent } from "./apply-event"
import { createChromeSlice } from "./chrome-slice"
import { StoreProviders } from "./ctx"
import { flushPendingDraftPersist, persistDraftSessions, rekeyDraftSessions } from "./draft-session-state"
import { reportError, type StoreHandle } from "./handle"
import { persistSelection, createModelSlice } from "./model-slice"
import { pushPermissionMode } from "./permission-sync"
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
    if (project && !project.missing) {
      const statuses = await client.listSessionStatuses(project.path).catch(() => null)
      if (statuses) {
        const owned = new Set((state.sessionsByProject[project.path] ?? []).map((item) => item.id))
        setState(
          produce((draft) => {
            for (const [sessionID, queue] of Object.entries(draft.queuedBySession)) {
              const directory = queue?.[0]?.directory
              const inProject = owned.has(sessionID) || (directory ? samePath(directory, project.path) : false)
              if (!inProject) continue
              const live = statuses[sessionID]
              if (live?.type === "busy" || live?.type === "retry") draft.status[sessionID] = live
              else draft.status[sessionID] = { type: "idle" }
            }
          }),
        )
      }
    }
    const pending = new Set<string>([...Object.keys(state.queuedBySession), ...Object.keys(sendAfterIdle)])
    for (const sessionID of pending) {
      if ((state.queuedBySession[sessionID]?.length ?? 0) > 0 || sendAfterIdle[sessionID]) {
        void runtime.flushQueue(sessionID)
      }
    }
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
    persistSelection(handle, resolveSelectedKey(configured, mergeSelectables(configured, []), loadSelectedModelKey()))

    const hydratedDrafts = loadDraftSessions()
    setState("draftSessionsByProject", hydratedDrafts.draftSessionsByProject)
    setState("drafts", hydratedDrafts.drafts)
    setState("planModeBySession", hydratedDrafts.planModeBySession)
    const selectedProject = initial.find((project) => project.id === selectedId)
    const restoredDraft = selectedProject
      ? newestDraft(hydratedDrafts.draftSessionsByProject[selectedProject.path] ?? [])
      : undefined
    if (restoredDraft) setState({ selectedSessionId: restoredDraft.id, draft: true })

    for (const project of initial) {
      void projects.hydrateProjectPath(project)
    }

    void resolveHomeDir().then((home) => {
      if (!home) return
      let nextSelected: string | null = null
      let rekeyed = false
      setState(
        produce((draft) => {
          const previous = draft.projects.find(isLocalProject)
          const previousPath = previous?.path
          draft.projects = ensureLocalProject(draft.projects, home)
          if (previousPath && !samePath(previousPath, home)) {
            rekeyDraftSessions(draft, previousPath, home)
            rekeyed = true
          }
          if (!draft.selectedProjectId || !draft.projects.some((project) => project.id === draft.selectedProjectId)) {
            draft.selectedProjectId = pickSelectedProjectId(draft.projects, last)
          }
          nextSelected = draft.selectedProjectId
        }),
      )
      if (nextSelected) saveLastProject(nextSelected)
      if (rekeyed) persistDraftSessions(handle, true)
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

    // 其他实例（run.sh 开发版 / 安装版）改了共享设置时，跟随更新本地状态。
    // 只改 state，不再回写 shared，避免两个实例互相回环。
    const applySharedPatch = (patch: SharedSettings) => {
      if (patch.sendShortcut && patch.sendShortcut !== state.sendShortcut) {
        setState("sendShortcut", patch.sendShortcut)
      }
      if (patch.permissionMode && patch.permissionMode !== state.permissionMode) {
        setState("permissionMode", patch.permissionMode)
        void pushPermissionMode(handle, patch.permissionMode).catch((error) => {
          reportError(handle, error, "更新权限失败")
        })
      }
      if (typeof patch.keepBackendAlive === "boolean" && patch.keepBackendAlive !== state.keepBackendAlive) {
        setState("keepBackendAlive", patch.keepBackendAlive)
      }
      if (patch.models || "selectedModelKey" in patch) {
        const configured = loadConfiguredModels()
        const extras = menuDiscoveredModels(state.discoveredModels)
        const nextKey = resolveSelectedKey(configured, mergeSelectables(configured, extras), loadSelectedModelKey())
        persistSelection(handle, nextKey)
        setState({ configuredModels: configured, selectedModelKey: nextKey })
        const backendPatch = toBackendPatch(configured, nextKey)
        if (backendPatch) void client.patchGlobalConfig(backendPatch).catch(() => undefined)
      }
    }
    const unsubscribeShared = onSharedChange(applySharedPatch)

    let closing = false
    let unlistenClose: (() => void) | undefined
    let closeDisposed = false
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window")
        const win = getCurrentWindow()
        const unlisten = await win.onCloseRequested(async (event) => {
          if (closing) return
          event.preventDefault()
          closing = true
          await Promise.race([
            flushShared().catch(() => undefined),
            new Promise((resolve) => window.setTimeout(resolve, 1500)),
          ])
          flushPendingDraftPersist()
          await win.destroy()
        })
        if (closeDisposed) unlisten()
        else unlistenClose = unlisten
      } catch {
        // 浏览器预览没有窗口句柄
      }
    })()
    onCleanup(() => {
      closeDisposed = true
      unlistenClose?.()
    })

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
      flushPendingDraftPersist()
      stop()
      unsubscribeShared()
      window.clearInterval(ping)
      window.removeEventListener("pagehide", flushPendingDraftPersist)
      window.removeEventListener("beforeunload", flushPendingDraftPersist)
    })
    window.addEventListener("pagehide", flushPendingDraftPersist)
    window.addEventListener("beforeunload", flushPendingDraftPersist)
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
