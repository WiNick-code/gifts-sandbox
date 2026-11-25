// Расчёт корзины из командной строки.
// Пример: node scripts/price.ts C-001 2026-12-01 NY-01:10 TH-01:2 PEN-02:100
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../engine/src/load.ts';
import { formatRub, priceCart } from '../engine/src/index.ts';

const [customerId, date, ...items] = process.argv.slice(2);
if (!customerId || !date || items.length === 0) {
  console.log('Использование: node scripts/price.ts <клиент> <ГГГГ-ММ-ДД> <SKU:кол-во> [...]');
  process.exit(1);
}

const catalog = loadCatalog(fileURLToPath(new URL('../', import.meta.url)));
const cart = items.map((s) => {
  const [sku, qty] = s.split(':');
  return { sku, qty: Number(qty ?? 1) };
});
const res = priceCart(catalog, customerId, cart, date);
const customer = catalog.customers.get(customerId)!;

console.log(`\n${customer.name} · ${date}\n`);
for (const l of res.lines) {
  console.log(`${l.sku}  ${l.name}  × ${l.qty}`);
  console.log(`  прайс ${formatRub(l.listPrice)} → договор ${formatRub(l.contractPrice)} → итог ${formatRub(l.unitPrice)}  (${formatRub(l.total)})`);
  for (const c of l.candidates) {
    const mark = c.status === 'applied' ? '✔' : c.status === 'rejected' ? '·' : '○';
    const doc = c.document ? `  [${c.document.number} от ${c.document.date}]` : '';
    console.log(`    ${mark} ${c.title}: ${c.reason}${doc}`);
  }
}
console.log(`\nИтого ${formatRub(res.total)}  · по прайсу ${formatRub(res.listTotal)}  · выгода ${formatRub(res.savings)}\n`);
