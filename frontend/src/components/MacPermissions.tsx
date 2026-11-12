import { createSignal, onCleanup, onMount, Show } from "solid-js"
import {
  macPermissionStatus,
  openMacPermissionSettings,
  requestMacScreenRecording,
  restartCoda,
  type MacPermissionPane,
  type MacPermissionStatus,
} from "../lib/macos-permissions"
import { isMacPlatform, isTauri } from "../lib/platform"

const ONBOARDING_KEY = "coda.macosPermissionsOnboarded"

function StatusBadge(props: { status: MacPermissionStatus | null; granted: boolean }) {
  return (
    <span classList={{ "permission-status": true, granted: props.granted }}>
      {props.status ? (props.granted ? "已授权" : "未授权") : "检测中"}
    </span>
  )
}

/**
 * Explains macOS Full Disk Access once. macOS only allows the user to grant
 * this permission manually, so the best we can do is open the right pane.
 */
export function MacPermissionsOnboarding() {
  const [status, setStatus] = createSignal<MacPermissionStatus | null>(null)
  const [open, setOpen] = createSignal(false)
  const [requesting, setRequesting] = createSignal(false)

  const refresh = async () => {
    const next = await macPermissionStatus()
    setStatus(next)
    return next
  }

  const remember = () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, "done")
    } catch {
      // Private storage failures should not keep the dialog open forever.
    }
  }

  onMount(() => {
    void (async () => {
      if (!isMacPlatform() || !isTauri()) return
      try {
        if (localStorage.getItem(ONBOARDING_KEY) === "done") return
      } catch {
        return
      }
      const next = await refresh()
      if (!next.supported) return
      if (next.fullDiskAccess) {
        remember()
        return
      }
      setOpen(true)
    })()

    const onFocus = () => {
      if (open()) void refresh()
    }
    window.addEventListener("focus", onFocus)
    onCleanup(() => window.removeEventListener("focus", onFocus))
  })

  const dismiss = () => {
    remember()
    setOpen(false)
  }

  const openSettings = (pane: MacPermissionPane) => {
    void openMacPermissionSettings(pane)
  }

  const requestScreen = async () => {
    setRequesting(true)
    try {
      const granted = await requestMacScreenRecording()
      if (!granted) await openMacPermissionSettings("screenRecording")
      await refresh()
    } finally {
      setRequesting(false)
    }
  }

  const restart = () => {
    remember()
    void restartCoda()
  }

  return (
    <Show when={open()}>
      <div class="dialog-overlay">
        <div
          class="dialog permission-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mac-permission-title"
        >
          <header class="dialog-head">
            <h2 id="mac-permission-title">允许 Coda 访问你的文件</h2>
          </header>
          <p class="dialog-hint">
            macOS 会在 Coda 读写项目文件时反复弹出文件夹授权。开启「完整磁盘访问权限」一次，就能避免这些重复弹窗。
          </p>

          <section class="permission-card">
            <div class="permission-card-head">
              <span class="permission-card-title">完整磁盘访问权限</span>
              <StatusBadge status={status()} granted={status()?.fullDiskAccess ?? false} />
            </div>
            <p class="permission-card-hint">
              在「隐私与安全性 → 完整磁盘访问权限」中点按 +，再选择「应用程序」里的 Coda。
            </p>
            <button type="button" class="text-btn" onClick={() => openSettings("fullDiskAccess")}>
              打开系统设置
            </button>
          </section>

          <section class="permission-card">
            <div class="permission-card-head">
              <span class="permission-card-title">屏幕录制</span>
              <StatusBadge status={status()} granted={status()?.screenRecording ?? false} />
            </div>
            <p class="permission-card-hint">
              截图、录屏和查看屏幕需要这个权限。授权后如果 macOS 仍然询问，可以在系统设置里确认 Coda 已启用。
            </p>
            <div class="permission-card-actions">
              <button
                type="button"
                class="text-btn"
                disabled={requesting()}
                onClick={() => void requestScreen()}
              >
                {requesting() ? "等待系统确认…" : "申请屏幕录制"}
              </button>
              <button type="button" class="text-btn" onClick={() => openSettings("screenRecording")}>
                打开系统设置
              </button>
            </div>
          </section>

          <p class="permission-note">
            macOS 不允许应用自行勾选这些权限。授权后请重启 Coda 使其生效；系统偶尔重新检查屏幕录制权限时，按提示确认即可。
          </p>

          <div class="dialog-actions">
            <button type="button" class="ghost-btn" onClick={dismiss}>
              稍后
            </button>
            <button type="button" class="ghost-btn" onClick={() => void refresh()}>
              重新检测
            </button>
            <button type="button" class="send-btn" onClick={restart}>
              重启 Coda
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}

/** Compact permission rows shown inside the main Settings dialog. */
export function MacPermissionsSettings() {
  const [status, setStatus] = createSignal<MacPermissionStatus | null>(null)
  const [requesting, setRequesting] = createSignal(false)

  const refresh = async () => {
    setStatus(await macPermissionStatus())
  }

  onMount(() => {
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    onCleanup(() => window.removeEventListener("focus", onFocus))
  })

  const requestScreen = async () => {
    setRequesting(true)
    try {
      const granted = await requestMacScreenRecording()
      if (!granted) await openMacPermissionSettings("screenRecording")
      await refresh()
    } finally {
      setRequesting(false)
    }
  }

  const visible = () => isMacPlatform() && isTauri() && status()?.supported !== false

  return (
    <Show when={visible()}>
      <div class="settings-row settings-permission-row">
        <div class="settings-row-label">
          完整磁盘访问权限
          <span class="settings-permission-hint">减少项目文件夹的重复授权弹窗</span>
        </div>
        <div class="settings-permission-actions">
          <StatusBadge status={status()} granted={status()?.fullDiskAccess ?? false} />
          <button
            type="button"
            class="text-btn"
            onClick={() => void openMacPermissionSettings("fullDiskAccess")}
          >
            打开设置
          </button>
        </div>
      </div>

      <div class="settings-row settings-permission-row">
        <div class="settings-row-label">
          屏幕录制
          <span class="settings-permission-hint">截图、录屏和查看屏幕</span>
        </div>
        <div class="settings-permission-actions">
          <StatusBadge status={status()} granted={status()?.screenRecording ?? false} />
          <button
            type="button"
            class="text-btn"
            disabled={requesting()}
            onClick={() => void requestScreen()}
          >
            {requesting() ? "等待确认…" : "申请"}
          </button>
        </div>
      </div>

      <div class="settings-row">
        <div class="settings-row-label">权限更改后重启 Coda 生效</div>
        <button type="button" class="text-btn" onClick={() => void restartCoda()}>
          重启 Coda
        </button>
      </div>
    </Show>
  )
}