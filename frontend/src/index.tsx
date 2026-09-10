/* @refresh reload */
import { render } from "solid-js/web"
import "virtual:uno.css"
import "./styles/global.css"
import { applyWindowChromeAttr } from "./lib/platform"
import { initTheme } from "./lib/theme"
import App from "./App"

initTheme()
applyWindowChromeAttr()

render(() => <App />, document.getElementById("root") as HTMLElement)
