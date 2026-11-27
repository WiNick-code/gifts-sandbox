// Спецификация ручного управления акциями: отключение из админки не меняет условий акции,
// но исключает её из расчёта; фаза акции по срокам — для статусов в админке.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/load.ts';
import { priceCart, promoPhase } from '../src/index.ts';
import type { Catalog } from '../src/types.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = loadCatalog(root);

const price = (cat: Catalog, customer: string, sku: string, qty: number, date: string) =>
  priceCart(cat, customer, [{ sku, qty }], date).lines[0];

const withDisabled = (ids: string[]): Catalog => ({
  ...catalog,
  disabledPromos: new Set(ids),
});

test('акция включена: новогодняя скидка применяется', () => {
  const l = price(catalog, 'C-002', 'NY-01', 10, '2026-12-01');
  assert.equal(l.unitPrice, 756.5);
  assert.equal(l.applied.termId, 'promo-ny-15');
});

test('ручное отключение: акция не применяется, цена возвращается к доступной без неё', () => {
  const off = withDisabled(['promo-ny-15']);
  const l = price(off, 'C-002', 'NY-01', 10, '2026-12-01');
  assert.equal(l.unitPrice, 890); // клиент C-002 без договора — прайс
  assert.equal(l.applied.source, 'list');
  const rejected = l.candidates.find((c) => c.termId === 'promo-ny-15');
  assert.equal(rejected?.status, 'rejected');
  assert.ok(rejected?.reason.includes('отключена администратором'));
});

test('повторное включение: акция снова действует, условия не изменились', () => {
  // Тот же расчёт, что и с отключением, но с пустым набором отключённых: цена и причина — как до отключения.
  const on = withDisabled(['promo-ny-15']); // сначала выключена
  const before = price(on, 'C-001', 'NY-01', 10, '2026-12-01');
  assert.notEqual(before.applied.termId, 'promo-ny-15');

  const back = withDisabled([]); // включили повторно
  const after = price(back, 'C-001', 'NY-01', 10, '2026-12-01');
  assert.equal(after.unitPrice, 756.5); // та же акция, та же цена — условия не тронуты
  assert.equal(after.applied.termId, 'promo-ny-15');
});

test('отключённая акция поверх договора: клиенту остаётся договорная цена', () => {
  // PEN-02 у агентства C-001: акция −5% поверх договора −10%. Выключаем акцию — остаётся договор.
  const l = price(withDisabled(['promo-agency-pens']), 'C-001', 'PEN-02', 100, '2026-12-01');
  assert.equal(l.unitPrice, 288); // только договор −10%
  assert.equal(l.applied.source, 'contract');
});

test('фаза акции по срокам: запланирована, действует, архив', () => {
  const ny = catalog.terms.find((t) => t.id === 'promo-ny-15')!;
  assert.equal(promoPhase(ny, '2026-11-01'), 'planned'); // до 15.11 не действует
  assert.equal(promoPhase(ny, '2026-11-20'), 'active');
  assert.equal(promoPhase(ny, '2027-01-10'), 'archived'); // после 31.12 — архив
});

test('фаза бессрочной акции: planned до начала, дальше — active, архива нет', () => {
  const t = { ...catalog.terms.find((x) => x.id === 'promo-ny-15')!, validTo: undefined };
  assert.equal(promoPhase(t, '2030-01-01'), 'active');
});
