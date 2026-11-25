// Сборка демо-страницы: ядро движка + данные встраиваются в один самодостаточный HTML.
// node scripts/build-web.ts  →  dist/index.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadCatalog } from '../engine/src/load.ts';

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
  const data = { products: [...c.products.values()], customers: [...c.customers.values()], terms: c.terms };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function buildPage(): string {
  const tpl = readFileSync(join(root, 'web/index.html'), 'utf8');
  if (!tpl.includes('/*__ENGINE__*/') || !tpl.includes('/*__DATA__*/null')) throw new Error('В шаблоне нет меток сборки');
  return tpl.replace('/*__ENGINE__*/', () => bundleEngine()).replace('/*__DATA__*/null', () => bundleData());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(join(root, 'dist'), { recursive: true });
  const html = buildPage();
  writeFileSync(join(root, 'dist/index.html'), html);
  console.log(`dist/index.html — ${(html.length / 1024).toFixed(1)} КБ`);
}
