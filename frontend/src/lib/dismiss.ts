import { onCleanup, onMount } from "solid-js"

export function useDismissable(options: {
  active: () => boolean
  onClose: () => void
  root: () => HTMLElement | undefined
}) {
  onMount(() => {
    const onPointer = (event: PointerEvent) => {
      if (!options.active()) return
      const target = event.target as Node | null
      const node = options.root()
      if (node && target && node.contains(target)) return
      options.onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && options.active()) {
        // Consume dismissal before the composer's Escape-to-stop listener.
        event.preventDefault()
        options.onClose()
      }
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey, true)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey, true)
    })
  })
}
