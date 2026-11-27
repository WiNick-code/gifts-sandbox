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
  const html = buildPage('index.html');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!html.includes('/*__ENGINE__*/') && !html.includes('/*__DATA__*/'));
  assert.ok(html.includes('function priceCart'));
  assert.ok(html.includes('promo-ny-15'));
});

test('админка акций собирается: метки заменены, есть статусы и отключение', () => {
  const html = buildPage('admin.html');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!html.includes('/*__ENGINE__*/') && !html.includes('/*__DATA__*/'));
  assert.ok(html.includes('function promoPhase'));
  assert.ok(html.includes('gifts.promo-off'));
  assert.ok(html.includes('promo-edit.html') && html.includes('presets.html'));
  // в админке — только акции, договорные условия в список не попадают
  assert.ok(html.includes('promo-ny-15'));
});

test('страница пресетов собирается: механики и конструктор на месте', () => {
  const html = buildPage('presets.html');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!html.includes('/*__ENGINE__*/') && !html.includes('/*__DATA__*/'));
  assert.ok(html.includes('function mechanicStatus'));
  assert.ok(html.includes('percent-off-contract')); // справочник встроен
  assert.ok(html.includes('dialog')); // конструктор — модальное окно
  assert.ok(html.includes('Новая механика'));
});

test('страница настройки акции собирается: конструктор, предпросмотр, валидатор', () => {
  const html = buildPage('promo-edit.html');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!html.includes('/*__ENGINE__*/') && !html.includes('/*__DATA__*/'));
  assert.ok(html.includes('function validateCatalog')); // живая проверка черновика
  assert.ok(html.includes('Мин. маржа')); // ограничители в форме
  assert.ok(html.includes('Предпросмотр условия'));
});

test('палитры: три схемы и переключатель встроены во все страницы', () => {
  for (const tpl of ['index.html', 'admin.html', 'presets.html', 'promo-edit.html']) {
    const html = buildPage(tpl);
    assert.ok(html.includes('[data-palette="green"]'), `${tpl}: нет зелёной палитры`);
    assert.ok(html.includes('[data-palette="red"]'), `${tpl}: нет красной палитры`);
    assert.ok(html.includes('gifts.palette'), `${tpl}: нет переключателя палитры`);
    assert.ok(html.includes('data-palette-toggle'), `${tpl}: нет кнопки переключения`);
    assert.ok(!html.includes('href="theme.css"'), `${tpl}: css не заинлайнен`);
  }
});
