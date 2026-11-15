// 首屏上色：在 React 挂载前先决定主题，避免亮/暗切换时闪白。
(function () {
  try {
    var mode = localStorage.getItem("yys-theme") || "system";
    var dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var effective = mode === "light" || mode === "dark" ? mode : dark ? "dark" : "light";
    document.documentElement.dataset.theme = effective;
    var icon = document.querySelector('link[rel="icon"]');
    if (icon) {
      icon.href =
        effective === "dark" ? "/brand/icon-dark.png" : "/brand/icon-light.png";
    }
  } catch (error) {
    document.documentElement.dataset.theme = "dark";
  }
})();
