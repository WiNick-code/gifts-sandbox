import type { Customer, ISODate, Product, Term, TermEffect } from './types.ts';
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
