import type { CartLine, Catalog, DocumentRef, ISODate, PaymentTerms } from './types.ts';
import { priceCart } from './price.ts';
import { formatRub, toKop } from './money.ts';

export type OrderStatus = 'launched' | 'awaiting_prepayment' | 'blocked_credit_limit';

// Снимок заказа: цены зафиксированы в момент запуска и дальше не пересчитываются.
export interface OrderSnapshot {
  customerId: string;
  fixedAt: ISODate;
  status: OrderStatus;
  reason: string;
  payment: PaymentTerms;
  total: number;
  lines: Array<{
    sku: string;
    name: string;
    qty: number;
    unitPrice: number;
    total: number;
    termId: string | null;
    termTitle: string;
    document?: DocumentRef;
  }>;
}

export interface LaunchOptions {
  outstandingDebt?: number; // текущая задолженность клиента, руб. (в будущем — из учётной системы)
}

export function launchOrder(
  catalog: Catalog,
  customerId: string,
  cart: CartLine[],
  date: ISODate,
  opts: LaunchOptions = {},
): OrderSnapshot {
  const customer = catalog.customers.get(customerId);
  if (!customer) throw new Error(`Клиент ${customerId} не найден`);
  const priced = priceCart(catalog, customerId, cart, date);
  const pay = customer.payment;

  let status: OrderStatus = 'launched';
  let reason = '';
  switch (pay.type) {
    case 'prepay':
      status = 'awaiting_prepayment';
      reason = 'Условия клиента — 100% предоплата: заказ ждёт оплаты, цены зафиксированы.';
      break;
    case 'deferral':
      reason = `Отсрочка ${pay.days} дн.: заказ запущен.`;
      break;
    case 'deferral_limit': {
      const debt = opts.outstandingDebt ?? 0;
      if (toKop(debt) + toKop(priced.total) > toKop(pay.limit)) {
        status = 'blocked_credit_limit';
        reason = `Превышен кредитный лимит: задолженность ${formatRub(debt)} + заказ ${formatRub(priced.total)} > лимит ${formatRub(pay.limit)}.`;
      } else {
        reason = `Отсрочка ${pay.days} дн., лимит ${formatRub(pay.limit)} не превышен: заказ запущен.`;
      }
      break;
    }
  }

  const snapshot: OrderSnapshot = {
    customerId,
    fixedAt: date,
    status,
    reason,
    payment: pay,
    total: priced.total,
    lines: priced.lines.map((l) => ({
      sku: l.sku,
      name: l.name,
      qty: l.qty,
      unitPrice: l.unitPrice,
      total: l.total,
      termId: l.applied.termId,
      termTitle: l.applied.title,
      document: l.applied.document,
    })),
  };
  return deepFreeze(snapshot);
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}
