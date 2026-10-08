(function () {
  // Runs before first paint to avoid a flash of the wrong theme.
  // PREF_KEY mirrors STORAGE_KEYS.theme in src/lib/config.ts.
  var PREF_KEY = "coda.theme";
  var theme = "dark";
  try {
    var stored = window.localStorage.getItem(PREF_KEY);
    if (stored === "light" || stored === "dark") theme = stored;
  } catch (error) {
    theme = "dark";
  }
  document.documentElement.setAttribute("data-theme", theme);
  // Matches --bg in global.css. Keeps the first HTML paint off WebView2's white default.
  var bg = theme === "light" ? "#ffffff" : "#1e1e20";
  document.documentElement.style.setProperty("--boot-bg", bg);
})();
