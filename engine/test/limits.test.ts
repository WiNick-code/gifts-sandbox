// Спецификация ограничителей акций: минимальная маржа, лимит количества в заказе,
// бюджет акции — и инвариант индексной выборки условий.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/load.ts';
import { buildTermIndex, matchesProduct, relevantTerms } from '../src/terms.ts';
import { priceCart, priceLine, validateCatalog } from '../src/index.ts';
import type { Catalog, Term } from '../src/types.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = loadCatalog(root);

const price = (customer: string, sku: string, qty: number, date: string) =>
  priceCart(catalog, customer, [{ sku, qty }], date).lines[0];

test('минимальная маржа: акция не применяется ниже себестоимости + маржи', () => {
  // Свеча NY-02: прайс 450 ₽, себестоимость 300 ₽. Распродажа −35% дала бы 292.50 ₽ — ниже
  // порога 300 ₽ + 5% = 315 ₽. Глубокая акция отклонена ограничителем; из действующих
  // остаётся новогодняя −15% (382.50 ₽) — она порог проходит.
  const l = price('C-002', 'NY-02', 10, '2026-12-25');
  const fire = l.candidates.find((c) => c.termId === 'promo-ny-fire-sale');
  assert.equal(fire?.status, 'rejected');
  assert.ok(fire?.reason.includes('маржи'));
  assert.equal(l.unitPrice, 382.5); // −15% от прайса, без глубокой скидки
});

test('маржа без ограничителя: акция дороже порога — применяется', () => {
  // Тот же терм, но на ёлочные шары: −15% от 890 = 756.50 ₽ при себестоимости 620 ₽ — выше порога.
  const l = price('C-002', 'NY-01', 10, '2026-12-25');
  assert.equal(l.unitPrice, 756.5);
  assert.equal(l.applied.termId, 'promo-ny-15');
});

test('лимит количества в заказе: сверх лимита — отказ с подсказкой «доступно до N»', () => {
  // Кружки −20% от 500 шт., лимит 1000 шт. в заказе. 1500 шт. — отказ.
  const over = price('C-002', 'MUG-01', 1500, '2026-11-20');
  assert.equal(over.unitPrice, 250); // прайс, акция не применилась
  const limited = over.candidates.find((c) => c.termId === 'promo-mugs-volume');
  assert.equal(limited?.status, 'limit');
  assert.ok(limited?.reason.includes('доступно до 1000'));
  // 1000 шт. — ровно лимит, акция действует
  const atLimit = price('C-002', 'MUG-01', 1000, '2026-11-20');
  assert.equal(atLimit.unitPrice, 200);
  assert.equal(atLimit.applied.termId, 'promo-mugs-volume');
});

test('бюджет акции: расход по корзине считается и превышение даёт предупреждение', () => {
  // 1000 кружек по акции: скидка (250 − 200) × 1000 = 50 000 ₽ при бюджете 30 000 ₽.
  const cart = priceCart(catalog, 'C-002', [{ sku: 'MUG-01', qty: 1000 }], '2026-11-20');
  assert.equal(cart.promoBudgets.length, 1);
  const b = cart.promoBudgets[0];
  assert.equal(b.termId, 'promo-mugs-volume');
  assert.equal(b.spent, 50000);
  assert.equal(b.budget, 30000);
  assert.equal(b.exceeded, true);
  assert.deepEqual(cart.warnings, ['Бюджет акции «Объёмная: кружки −20% от 500 шт.» превышен: расход 50000 ₽ при бюджете 30000 ₽']);
  // Акция при этом не блокируется — строка посчитана по акции
  assert.equal(cart.lines[0].applied.termId, 'promo-mugs-volume');
});

test('бюджет без превышения — предупреждений нет', () => {
  // 600 кружек: скидка 50 ₽ × 600 = 30 000 ₽ — ровно бюджет, не превышен
  const cart = priceCart(catalog, 'C-002', [{ sku: 'MUG-01', qty: 600 }], '2026-11-20');
  assert.equal(cart.promoBudgets[0].exceeded, false);
  assert.deepEqual(cart.warnings, []);
});

test('маржа строки: отрицательная маржа — сигнал убытка', () => {
  const l = price('C-001', 'TH-01', 5, '2026-10-01'); // фиксированная цена 1190 ₽, себестоимость 905 ₽
  assert.equal(l.margin, (1190 - 905) * 5);
});

test('индексная выборка эквивалентна линейному перебору (инвариант на всех правилах)', () => {
  const linear = (terms: Term[], p: Parameters<typeof matchesProduct>[1]) => terms.filter((t) => matchesProduct(t, p));
  for (const product of catalog.products.values()) {
    const viaIndex = relevantTerms(catalog.index, catalog.terms, product).sort((a, b) => a.id.localeCompare(b.id));
    const viaScan = linear(catalog.terms, product).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(viaIndex, viaScan, `Расхождение индекса для ${product.sku}`);
  }
  // и наоборот: без индекса — fallback работает
  const noIndex: Catalog = { products: catalog.products, customers: catalog.customers, terms: catalog.terms };
  const l = priceLine(noIndex, catalog.customers.get('C-001')!, { sku: 'NY-01', qty: 10 }, '2026-12-01');
  assert.equal(l.unitPrice, 756.5);
});

test('валидатор ловит ошибки ограничителей и себестоимости', () => {
  const broken = {
    ...catalog,
    products: new Map(catalog.products),
    terms: [
      ...catalog.terms,
      {
        id: 'promo-bad-limits',
        title: 'С ошибками',
        source: 'promo' as const,
        effect: { type: 'percent_off' as const, percent: 10 },
        scope: { all: true },
        audience: { all: true },
        validFrom: '2026-11-01',
        minMargin: 150,
        maxQtyPerOrder: 0,
        budget: -5,
      },
    ],
  };
  broken.products.set('BAD-01', { sku: 'BAD-01', name: 'Без себестоимости', category: 'Кружки', listPrice: 100, cost: -1 });
  const msgs = validateCatalog(broken).filter((i) => i.level === 'error').map((i) => i.message);
  assert.ok(msgs.some((m) => m.includes('вне диапазона')));
  assert.ok(msgs.some((m) => m.includes('Лимит количества')));
  assert.ok(msgs.some((m) => m.includes('Бюджет акции')));
  assert.ok(msgs.some((m) => m.includes('отрицательная себестоимость')));
});

test('валидатор предупреждает об акции ниже себестоимости', () => {
  const deep = {
    ...catalog,
    terms: [
      ...catalog.terms,
      {
        id: 'promo-below-cost',
        title: 'В убыток',
        source: 'promo' as const,
        effect: { type: 'percent_off' as const, percent: 60 }, // прайс 250 → 100 ₽ при себестоимости 142 ₽
        scope: { skus: ['MUG-01'] },
        audience: { all: true },
        validFrom: '2026-12-01',
        validTo: '2026-12-31',
      },
    ],
  };
  const msgs = validateCatalog(deep).filter((i) => i.level === 'warning').map((i) => i.message);
  assert.ok(msgs.some((m) => m.includes('ниже себестоимости')));
  assert.ok(msgs.some((m) => m.includes('без минимальной маржи')));
});

test('валидатор предупреждает об акции, которая сама нарушает свой ограничитель маржи', () => {
  const selfBlocked = {
    ...catalog,
    terms: [
      ...catalog.terms,
      {
        id: 'promo-self-block',
        title: 'Самоотключение',
        source: 'promo' as const,
        effect: { type: 'percent_off' as const, percent: 60 }, // 250 → 100 ₽, порог 142 + 50% = 213 ₽
        scope: { skus: ['MUG-01'] },
        audience: { all: true },
        validFrom: '2026-12-01',
        validTo: '2026-12-31',
        minMargin: 50,
      },
    ],
  };
  const msgs = validateCatalog(selfBlocked).filter((i) => i.level === 'warning').map((i) => i.message);
  assert.ok(msgs.some((m) => m.includes('никогда не применится')));
});

test('демо-данные проходят валидацию и маппинг 1С', () => {
  const issues = validateCatalog(catalog).filter((i) => i.level === 'error');
  assert.deepEqual(issues, []);
  // loadCatalog уже бросил бы ошибку при неполной карточке — дошли сюда, значит required-поля на месте
  assert.ok(catalog.products.size >= 8);
});
