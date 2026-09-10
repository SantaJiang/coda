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
})();
