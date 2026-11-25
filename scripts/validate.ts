// Проверка правил: node scripts/validate.ts — код выхода 1 при ошибках.
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../engine/src/load.ts';
import { validateCatalog } from '../engine/src/index.ts';

const catalog = loadCatalog(fileURLToPath(new URL('../', import.meta.url)));
const issues = validateCatalog(catalog);

for (const i of issues) {
  console.log(`${i.level === 'error' ? '✖ ОШИБКА' : '⚠ внимание'}  ${i.termId ?? ''}  ${i.message}${i.origin ? `  (${i.origin})` : ''}`);
}
const errors = issues.filter((i) => i.level === 'error').length;
console.log(`\nУсловий: ${catalog.terms.length}, ошибок: ${errors}, предупреждений: ${issues.length - errors}`);
process.exit(errors ? 1 : 0);
