// Спецификация механик акций: справочник пресетов, статусы механик, связь акций с механикой.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/load.ts';
import { mechanicStatus, promoPhase } from '../src/index.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = loadCatalog(root);

test('справочник механик загружается', () => {
  assert.ok(catalog.mechanics);
  assert.ok(catalog.mechanics.size >= 5);
  const percent = catalog.mechanics.get('percent-off');
  assert.equal(percent?.title, 'Скидка в процентах');
  assert.equal(percent?.effect.type, 'percent_off');
});

test('каждая акция ссылается на известную механику (или без неё)', () => {
  // загрузчик уже бросил бы ошибку при неизвестной механике; здесь — проверка связности демо-данных
  const withMechanic = catalog.terms.filter((t) => t.mechanic);
  assert.ok(withMechanic.length >= 5, 'демо-акции должны быть привязаны к механикам');
  for (const t of withMechanic) {
    assert.ok(catalog.mechanics!.has(t.mechanic!), `акция ${t.id} ссылается на неизвестную механику`);
  }
});

test('статус механики: активна / используется / в архиве', () => {
  const today = '2026-11-27';
  const mechanics = catalog.mechanics!;

  // clearance — помечена архивом в справочнике
  assert.equal(mechanicStatus(mechanics.get('clearance')!, catalog.terms, today), 'archived');

  // percent-off — на ней созданы действующие акции (новогодняя, осенняя... осенняя уже архив,
  // но новогодняя действует) → «используется»
  assert.equal(mechanicStatus(mechanics.get('percent-off')!, catalog.terms, today), 'in_use');

  // fixed-price — ни одна акция не создана → просто «активна»
  assert.equal(mechanicStatus(mechanics.get('fixed-price')!, catalog.terms, today), 'active');
});

test('механика «используется», пока её акции запланированы или действуют, и перестаёт — когда все в архиве', () => {
  const mechanics = catalog.mechanics!;
  const percent = mechanics.get('percent-off')!;

  // 01.10.2026: новогодняя ещё не началась, но запланирована — механика уже «используется»
  assert.equal(mechanicStatus(percent, catalog.terms, '2026-10-01'), 'in_use');
  // 01.02.2027: все акции на percent-off завершены — механика снова просто «активна»
  assert.equal(mechanicStatus(percent, catalog.terms, '2027-02-01'), 'active');
});

test('механика наследует акциям свои настройки: акция поверх договора ссылается на percent-off-contract', () => {
  const pens = catalog.terms.find((t) => t.id === 'promo-agency-pens')!;
  assert.equal(pens.mechanic, 'percent-off-contract');
  assert.equal(pens.base, 'contract'); // наследованное от механики
  const mech = catalog.mechanics!.get('percent-off-contract')!;
  assert.equal(mech.base, 'contract');
});

test('статусы согласованы с фазами акций', () => {
  // акция в архиве не делает механику «используемой»
  const autumn = catalog.terms.find((t) => t.id === 'promo-autumn-nb')!;
  assert.equal(promoPhase(autumn, '2026-11-27'), 'archived');
  const amountOff = catalog.mechanics!.get('amount-off')!;
  assert.equal(mechanicStatus(amountOff, catalog.terms, '2026-11-27'), 'active');
});
