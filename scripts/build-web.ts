// Сборка демо-страниц: ядро движка + данные встраиваются в каждый самодостаточный HTML.
// node scripts/build-web.ts  →  dist/index.html, dist/admin.html (+ статические страницы)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import vm from 'node:vm';
import { loadCatalog } from '../engine/src/load.ts';
import { buildTermIndex } from '../engine/src/terms.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

// Порядок важен: модуль идёт после тех, от кого зависит. types.ts — только типы, его не нужно.
const MODULES = ['money', 'terms', 'price', 'order', 'validate'];

export function bundleEngine(): string {
  return MODULES.map((m) => {
    const src = readFileSync(join(root, 'engine/src', `${m}.ts`), 'utf8');
    const js = stripTypeScriptTypes(src, { mode: 'strip' })
      .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?/gm, '')
      .replace(/^export (?=(async )?function|const|let|class)/gm, '');
    if (/^\s*(import|export)\s/m.test(js)) throw new Error(`Не удалось развернуть модуль ${m}.ts`);
    return `// ---- ${m}.ts ----\n${js.trim()}\n`;
  }).join('\n');
}

export function bundleData(): string {
  const c = loadCatalog(root);
  const data = {
    products: [...c.products.values()],
    customers: [...c.customers.values()],
    terms: c.terms,
    presets: [...(c.mechanics?.values() ?? [])],
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

// Страница с движком: витрина, админка акций, пресеты механик и настройка акции
// собираются одинаково: общий движок + данные + палитра + переключатель палитры.
export function buildPage(template = 'index.html'): string {
  const tpl = readFileSync(join(root, 'web', template), 'utf8');
  if (!tpl.includes('/*__ENGINE__*/') || !tpl.includes('/*__DATA__*/null')) throw new Error(`В шаблоне ${template} нет меток сборки`);
  const theme = readFileSync(join(root, 'web/theme.css'), 'utf8');
  const palette = readFileSync(join(root, 'web/palette.js'), 'utf8');
  const html = tpl
    // CSS-палитра: отдельный файл при сборке становится инлайном (страницы остаются самодостаточными)
    .replace('<link rel="stylesheet" href="theme.css">', `<style>${theme}</style>`)
    .replace('/*__ENGINE__*/', () => bundleEngine())
    .replace('/*__DATA__*/null', () => bundleData())
    .replace('/*__PALETTE__*/', () => palette)
    // В браузере нет загрузчика с диска — индекс условий строится на встроенных данных.
    .replace('terms: DATA.terms', 'terms: DATA.terms, index: buildTermIndex(DATA.terms)');
  checkInlineScripts(html, template);
  return html;
}

// Inline-скрипты пишутся на чистом JS (typecheck их не видит) — проверяем синтаксис при сборке,
// чтобы опечатка не дожила до браузера. Скрипты со src не трогаем: их нет, всё встраивается.
// new Function не годится: тело-блок «{ ... }» (паттерн витрины) он парсит как выражение — vm.Script честнее.
function checkInlineScripts(html: string, template: string): void {
  for (const code of html.match(/<script>[\s\S]*?<\/script>/g) ?? []) {
    const body = code.slice('<script>'.length, -'<\/script>'.length);
    try {
      new vm.Script(body, { filename: `${template} (inline script)` });
    } catch (e) {
      throw new Error(`Синтаксическая ошибка в inline-скрипте ${template}: ${(e as Error).message}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(join(root, 'dist'), { recursive: true });
  for (const [name, template] of [
    ['index.html', 'index.html'], // витрина расчёта
    ['admin.html', 'admin.html'], // админка акций
    ['presets.html', 'presets.html'], // пресеты механик
    ['promo-edit.html', 'promo-edit.html'], // настройка акции
  ]) {
    const html = buildPage(template);
    writeFileSync(join(root, 'dist', name), html);
    console.log(`dist/${name} — ${(html.length / 1024).toFixed(1)} КБ`);
  }
}
