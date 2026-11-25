import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/load.ts';
import { launchOrder, priceCart, validateCatalog } from '../src/index.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = loadCatalog(root);

const price = (customer: string, sku: string, qty: number, date: string) =>
  priceCart(catalog, customer, [{ sku, qty }], date).lines[0];

test('без договора и акций — прайсовая цена', () => {
  const l = price('C-002', 'MUG-01', 10, '2026-10-01');
  assert.equal(l.unitPrice, 250);
  assert.equal(l.applied.source, 'list');
});

test('договорная скидка на весь ассортимент', () => {
  const l = price('C-001', 'MUG-01', 10, '2026-10-01');
  assert.equal(l.unitPrice, 232.5); // 250 − 7%
  assert.equal(l.applied.termId, 'c001-base-7');
});

test('допсоглашение по конкретному SKU перекрывает общую скидку договора', () => {
  const l = price('C-001', 'TH-01', 5, '2026-10-01');
  assert.equal(l.unitPrice, 1190);
  assert.equal(l.applied.termId, 'c001-thermos-1190');
  assert.ok(l.candidates.some((c) => c.termId === 'c001-base-7' && c.status === 'rejected'));
});

test('до даты допсоглашения действует только договор', () => {
  const l = price('C-001', 'TH-01', 5, '2026-05-31');
  assert.equal(l.unitPrice, 1385.7); // 1490 − 7%
});

test('акция выигрывает, если выгоднее договорной цены', () => {
  const l = price('C-001', 'NY-01', 10, '2026-12-01');
  assert.equal(l.unitPrice, 756.5); // 890 − 15% (договор дал бы 827.70)
  assert.equal(l.applied.termId, 'promo-ny-15');
});

test('после окончания акции цена автоматически возвращается к договорной', () => {
  const l = price('C-001', 'NY-01', 10, '2027-01-10');
  assert.equal(l.unitPrice, 827.7);
  assert.equal(l.applied.source, 'contract');
});

test('акция «от договорной цены» складывается с договором', () => {
  const l = price('C-001', 'PEN-02', 100, '2026-12-01');
  assert.equal(l.unitPrice, 273.6); // 320 − 10% = 288, затем −5%
  assert.equal(l.applied.termId, 'promo-agency-pens');
});

test('сегментная акция не достаётся клиенту другого сегмента', () => {
  const l = price('C-003', 'PEN-02', 100, '2026-12-01');
  assert.equal(l.unitPrice, 304); // только договор −5%
});

test('порог количества: подсказка, пока не набрано; применение — когда набрано', () => {
  const few = price('C-002', 'MUG-01', 100, '2026-11-20');
  assert.equal(few.unitPrice, 250);
  assert.ok(few.candidates.some((c) => c.termId === 'promo-mugs-volume' && c.status === 'not_eligible'));
  const many = price('C-002', 'MUG-01', 500, '2026-11-20');
  assert.equal(many.unitPrice, 200);
});

test('у разных строк корзины — свои условия; итог и выгода считаются', () => {
  const cart = priceCart(
    catalog,
    'C-001',
    [
      { sku: 'NY-01', qty: 10 },
      { sku: 'TH-01', qty: 2 },
      { sku: 'MUG-01', qty: 4 },
    ],
    '2026-12-01',
  );
  assert.deepEqual(
    cart.lines.map((l) => l.applied.termId),
    ['promo-ny-15', 'c001-thermos-1190', 'c001-base-7'],
  );
  assert.equal(cart.total, 7565 + 2380 + 930);
  assert.equal(cart.savings, cart.listTotal - cart.total);
});

test('запуск заказа фиксирует цену: снимок не меняется после окончания акции', () => {
  const order = launchOrder(catalog, 'C-001', [{ sku: 'NY-01', qty: 10 }], '2026-12-30');
  assert.equal(order.status, 'launched');
  assert.equal(order.lines[0].unitPrice, 756.5);
  assert.ok(Object.isFrozen(order.lines[0]));
  const later = price('C-001', 'NY-01', 10, '2027-01-10');
  assert.equal(later.unitPrice, 827.7);
  assert.equal(order.lines[0].unitPrice, 756.5);
});

test('условия запуска: предоплата, отсрочка, превышение лимита', () => {
  const cart = [{ sku: 'TH-01', qty: 10 }];
  assert.equal(launchOrder(catalog, 'C-002', cart, '2026-12-01').status, 'awaiting_prepayment');
  assert.equal(launchOrder(catalog, 'C-003', cart, '2026-12-01').status, 'launched');
  assert.equal(
    launchOrder(catalog, 'C-001', cart, '2026-12-01', { outstandingDebt: 495000 }).status,
    'blocked_credit_limit',
  );
});

test('демо-правила проходят валидацию без ошибок', () => {
  const errors = validateCatalog(catalog).filter((i) => i.level === 'error');
  assert.deepEqual(errors, []);
});

test('валидатор ловит типичные ошибки', () => {
  const broken = {
    ...catalog,
    terms: [
      ...catalog.terms,
      {
        id: 'promo-ny-15',
        title: 'дубль',
        source: 'promo' as const,
        effect: { type: 'percent_off' as const, percent: 120 },
        scope: { skus: ['NOPE'] },
        audience: { all: true },
        validFrom: '2026-12-10',
        validTo: '2026-12-01',
      },
    ],
  };
  const msgs = validateCatalog(broken).filter((i) => i.level === 'error').map((i) => i.message);
  assert.ok(msgs.some((m) => m.includes('Дублируется')));
  assert.ok(msgs.some((m) => m.includes('вне диапазона')));
  assert.ok(msgs.some((m) => m.includes('NOPE')));
  assert.ok(msgs.some((m) => m.includes('раньше даты начала')));
});
