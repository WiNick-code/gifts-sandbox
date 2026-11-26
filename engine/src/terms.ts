import type { Customer, ISODate, Product, Term, TermEffect, TermIndex } from './types.ts';
import { toKop } from './money.ts';

export function isActive(t: Term, date: ISODate): boolean {
  return t.validFrom <= date && (!t.validTo || date <= t.validTo);
}

export function matchesProduct(t: Term, p: Product): boolean {
  const s = t.scope;
  if (s.excludeSkus?.includes(p.sku)) return false;
  if (s.all) return true;
  return Boolean(s.skus?.includes(p.sku) || s.categories?.includes(p.category));
}

export function matchesCustomer(t: Term, c: Customer): boolean {
  const a = t.audience;
  if (a.all) return true;
  return Boolean(a.customerIds?.includes(c.id) || a.segments?.includes(c.segment));
}

// Инвертированный индекс: условия, относящиеся к товару, ищутся без перебора всех условий.
// Дорого один раз, зато потом каждая строка корзины стоит O(условий на товар), а не O(всех условий).
export function buildTermIndex(terms: Term[]): TermIndex {
  const index: TermIndex = { bySku: new Map(), byCategory: new Map(), global: [], excluded: new Map() };
  for (const t of terms) {
    const s = t.scope;
    for (const sku of s.excludeSkus ?? []) push(index.excluded, sku, t);
    if (s.all) index.global.push(t);
    for (const sku of s.skus ?? []) push(index.bySku, sku, t);
    for (const cat of s.categories ?? []) push(index.byCategory, cat, t);
  }
  return index;
}

const push = (m: Map<string, Term[]>, key: string, t: Term) => {
  const list = m.get(key);
  if (list) list.push(t);
  else m.set(key, [t]);
};

// Условия, которые могут относиться к товару: весь ассортимент + SKU + категория,
// минус явно исключившие этот SKU. Порядок внутри не гарантируется — сортирует расчётчик.
export function relevantTerms(index: TermIndex | undefined, terms: Term[], p: Product): Term[] {
  if (!index) return terms.filter((t) => matchesProduct(t, p)); // fallback: каталог без индекса
  const seen = new Set<Term>();
  const result: Term[] = [];
  const add = (t: Term) => {
    if (!seen.has(t)) {
      seen.add(t);
      result.push(t);
    }
  };
  index.global.forEach(add);
  (index.bySku.get(p.sku) ?? []).forEach(add);
  (index.byCategory.get(p.category) ?? []).forEach(add);
  for (const t of index.excluded.get(p.sku) ?? []) seen.add(t); // исключённые — не добавляем
  return result;
}

// Минимально допустимая цена акции по ограничителю маржи, в копейках:
// себестоимость × (1 + minMargin%). Функция нужна и расчёту, и валидатору.
export function marginFloorKop(t: Term, p: Product): number | null {
  if (t.minMargin == null) return null;
  return Math.round((toKop(p.cost) * (100 + t.minMargin)) / 100);
}

// Насколько точно условие нацелено на товар: SKU > категория > весь ассортимент.
export function specificity(t: Term, p: Product): number {
  if (t.scope.skus?.includes(p.sku)) return 3;
  if (t.scope.categories?.includes(p.category)) return 2;
  return 1;
}

// Применить эффект к цене (в копейках), результат — в копейках, не ниже нуля.
export function applyEffect(effect: TermEffect, baseKop: number): number {
  switch (effect.type) {
    case 'percent_off':
      return Math.max(0, Math.round((baseKop * (100 - effect.percent)) / 100));
    case 'amount_off':
      return Math.max(0, baseKop - toKop(effect.amount));
    case 'fixed_price':
      return Math.max(0, toKop(effect.price));
  }
}

export function describeEffect(effect: TermEffect): string {
  switch (effect.type) {
    case 'percent_off':
      return `скидка ${effect.percent}%`;
    case 'amount_off':
      return `скидка ${effect.amount} ₽/шт.`;
    case 'fixed_price':
      return `цена ${effect.price} ₽/шт.`;
  }
}
