// Переключатель палитры: общий скрипт для всех страниц песочницы.
// Палитра — атрибут <html data-palette>, хранится в localStorage и применяется
// на всех страницах сразу (событие storage — в других вкладках).
// Встраивается в страницы сборкой (build-web.ts инлайнит этот файл после theme.css).
(() => {
  const KEY = "gifts.palette";
  const ORDER = ["magenta", "green", "red"];
  const LABEL = { magenta: "Пурпурная", green: "Зелёная", red: "Красная" };
  const ICON = { magenta: "◍", green: "◔", red: "◕" };

  const apply = (name) => {
    document.documentElement.dataset.palette = name;
    for (const b of document.querySelectorAll("[data-palette-toggle]")) {
      const next = ORDER[(ORDER.indexOf(name) + 1) % ORDER.length];
      b.textContent = `${ICON[name]} ${LABEL[name]}`;
      b.title = `Палитра: ${LABEL[next]} — нажмите для переключения`;
    }
  };
  const current = () => localStorage.getItem(KEY) ?? "magenta";

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-palette-toggle]");
    if (!b) return;
    localStorage.setItem(KEY, ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length]);
    apply(current());
  });

  // Другая вкладка сменила палитру — меняем и здесь, не трогая форму.
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) apply(e.newValue ?? "magenta");
  });

  // Ранняя установка: до отрисовки контента, чтобы не мигало.
  apply(current());
})();
