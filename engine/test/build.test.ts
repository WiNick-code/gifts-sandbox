// Демо-страница считает тем же кодом, что и тесты: проверяем, что собранное ядро даёт те же цены.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundleData, bundleEngine, buildPage } from '../../scripts/build-web.ts';

test('собранное для браузера ядро считает так же, как исходное', () => {
  const ctx: Record<string, unknown> = {};
  vm.createContext(ctx);
  vm.runInContext(`${bundleEngine()}\nthis.api = { priceCart, launchOrder, validateCatalog };`, ctx);
  const data = JSON.parse(bundleData());
  const catalog = {
    products: new Map(data.products.map((p: { sku: string }) => [p.sku, p])),
    customers: new Map(data.customers.map((c: { id: string }) => [c.id, c])),
    terms: data.terms,
  };
  const api = ctx.api as { priceCart: Function; validateCatalog: Function };
  const cart = api.priceCart(catalog, 'C-001', [{ sku: 'NY-01', qty: 10 }, { sku: 'PEN-02', qty: 100 }], '2026-12-01');
  assert.equal(cart.lines[0].unitPrice, 756.5);
  assert.equal(cart.lines[1].unitPrice, 273.6);
  assert.equal(api.validateCatalog(catalog).filter((i: { level: string }) => i.level === 'error').length, 0);
});

test('страница собирается: метки заменены, данные встроены', () => {
  const html = buildPage();
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!html.includes('/*__ENGINE__*/') && !html.includes('/*__DATA__*/'));
  assert.ok(html.includes('function priceCart'));
  assert.ok(html.includes('promo-ny-15'));
});
