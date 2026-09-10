/* @refresh reload */
import { render } from "solid-js/web"
import "virtual:uno.css"
import "./styles/global.css"
import { initTheme } from "./lib/theme"
import App from "./App"

initTheme()

render(() => <App />, document.getElementById("root") as HTMLElement)
