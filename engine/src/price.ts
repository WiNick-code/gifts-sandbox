import type { Candidate, CartLine, Catalog, Customer, ISODate, PricedCart, PricedLine, PromoBudget, Term } from './types.ts';
import { fromKop, toKop } from './money.ts';
import {
  applyEffect,
  describeEffect,
  isActive,
  marginFloorKop,
  matchesCustomer,
  relevantTerms,
  specificity,
} from './terms.ts';

/**
 * Правила расчёта цены строки:
 * 1. Прайсовая цена — отправная точка.
 * 2. Договорная цена клиента: из действующих условий договора выбирается одно —
 *    с наибольшим приоритетом, затем самое точное (SKU > категория > всё), затем самое позднее
 *    (более позднее допсоглашение перекрывает предыдущее).
 * 3. Каждая действующая акция считает цену от прайса или от договорной цены (поле base).
 *    Ограничители: акция не применяется ниже минимальной маржи (minMargin) и сверх
 *    лимита количества в заказе (maxQtyPerOrder).
 * 4. Клиент получает минимальную цену из договорной и акционных. Когда акция заканчивается
 *    (или срабатывает ограничитель), она просто перестаёт быть кандидатом — цена
 *    автоматически возвращается к договорной.
 */
export function priceLine(catalog: Catalog, customer: Customer, line: CartLine, date: ISODate): PricedLine {
  const product = catalog.products.get(line.sku);
  if (!product) throw new Error(`Товар ${line.sku} не найден в каталоге`);

  const listKop = toKop(product.listPrice);
  const candidates: Candidate[] = [];

  const relevant = relevantTerms(catalog.index, catalog.terms, product).filter(
    (t) => isActive(t, date) && matchesCustomer(t, customer),
  );
  const eligible = relevant.filter((t) => !t.minQty || line.qty >= t.minQty);

  // Условия, которым не хватило количества, показываем как подсказку менеджеру/клиенту.
  for (const t of relevant.filter((t) => !eligible.includes(t))) {
    candidates.push({
      termId: t.id,
      title: t.title,
      source: t.source,
      unitPrice: null,
      status: 'not_eligible',
      reason: `доступно от ${t.minQty} шт. (в корзине ${line.qty})`,
      document: t.document,
    });
  }

  // Договорная цена
  const contracts = eligible
    .filter((t) => t.source === 'contract')
    .sort(
      (a, b) =>
        (b.priority ?? 0) - (a.priority ?? 0) ||
        specificity(b, product) - specificity(a, product) ||
        b.validFrom.localeCompare(a.validFrom),
    );
  const contract: Term | undefined = contracts[0];
  const contractKop = contract ? applyEffect(contract.effect, listKop) : listKop;

  for (const t of contracts.slice(1)) {
    candidates.push({
      termId: t.id,
      title: t.title,
      source: 'contract',
      unitPrice: fromKop(applyEffect(t.effect, listKop)),
      status: 'rejected',
      reason: `перекрыто условием договора «${contract!.title}» (приоритет, точность или более поздний документ)`,
      document: t.document,
    });
  }

  type Option = { kop: number; term: Term | null; source: Candidate['source'] };
  const options: Option[] = [{ kop: contractKop, term: contract ?? null, source: contract ? 'contract' : 'list' }];

  for (const t of eligible.filter((t) => t.source === 'promo')) {
    const base = t.base === 'contract' ? contractKop : listKop;
    const promoKop = applyEffect(t.effect, base);

    // Ограничитель маржи: акция не может продавать ниже себестоимости + минимальной маржи.
    const floor = marginFloorKop(t, product);
    if (floor != null && promoKop < floor) {
      candidates.push({
        termId: t.id,
        title: t.title,
        source: 'promo',
        unitPrice: fromKop(promoKop),
        status: 'rejected',
        reason: `ниже минимальной маржи: цена ${fromKop(promoKop)} ₽ < себестоимость ${product.cost} ₽ + маржа ${t.minMargin}% (${fromKop(floor)} ₽)`,
        document: t.document,
      });
      continue;
    }

    // Ограничитель количества: акция не действует сверх лимита штук в заказе.
    if (t.maxQtyPerOrder != null && line.qty > t.maxQtyPerOrder) {
      candidates.push({
        termId: t.id,
        title: t.title,
        source: 'promo',
        unitPrice: fromKop(promoKop),
        status: 'limit',
        reason: `лимит ${t.maxQtyPerOrder} шт. в заказе (в корзине ${line.qty} шт.) — доступно до ${t.maxQtyPerOrder} шт.`,
        document: t.document,
      });
      continue;
    }

    options.push({ kop: promoKop, term: t, source: 'promo' });
  }

  // Минимальная цена; при равенстве — больший приоритет, затем договор (без акции).
  const best = options.reduce((acc, o) => {
    if (o.kop < acc.kop) return o;
    if (o.kop === acc.kop && (o.term?.priority ?? 0) > (acc.term?.priority ?? 0)) return o;
    return acc;
  });

  for (const o of options) {
    const isBest = o === best;
    const label = o.term
      ? `${describeEffect(o.term.effect)}${o.term.source === 'promo' ? `, от ${o.term.base === 'contract' ? 'договорной' : 'прайсовой'} цены` : ''}`
      : 'прайсовая цена';
    candidates.push({
      termId: o.term?.id ?? null,
      title: o.term?.title ?? 'Прайс',
      source: o.source,
      unitPrice: fromKop(o.kop),
      status: isBest ? 'applied' : 'rejected',
      reason: isBest ? `применено: ${label}` : `${label} — невыгоднее применённого`,
      document: o.term?.document,
    });
  }

  candidates.sort((a, b) => order(a.status) - order(b.status));

  return {
    sku: product.sku,
    name: product.name,
    qty: line.qty,
    listPrice: product.listPrice,
    contractPrice: fromKop(contractKop),
    unitPrice: fromKop(best.kop),
    total: fromKop(best.kop * line.qty),
    margin: fromKop((best.kop - toKop(product.cost)) * line.qty),
    applied: {
      termId: best.term?.id ?? null,
      title: best.term?.title ?? 'Прайс',
      source: best.source,
      document: best.term?.document,
    },
    candidates,
  };
}

const order = (s: Candidate['status']) =>
  s === 'applied' ? 0 : s === 'rejected' ? 1 : s === 'limit' ? 2 : 3;

export function priceCart(catalog: Catalog, customerId: string, cart: CartLine[], date: ISODate): PricedCart {
  const customer = catalog.customers.get(customerId);
  if (!customer) throw new Error(`Клиент ${customerId} не найден`);
  const lines = cart.map((l) => priceLine(catalog, customer, l, date));
  const totalKop = lines.reduce((s, l) => s + toKop(l.total), 0);
  const listKop = lines.reduce((s, l) => s + toKop(l.listPrice) * l.qty, 0);

  // Бюджеты акций: сколько скидки дала каждая акция с заданным бюджетом.
  // Бюджет — учётный ограничитель: акция не блокируется, но превышение показывается предупреждением.
  const byId = new Map(catalog.terms.map((t) => [t.id, t]));
  const spent = new Map<string, number>();
  for (const l of lines) {
    if (l.applied.termId == null) continue;
    const t = byId.get(l.applied.termId);
    if (!t || t.source !== 'promo' || t.budget == null) continue;
    const effectKop = toKop(l.listPrice) - toKop(l.unitPrice); // скидка за единицу
    spent.set(t.id, (spent.get(t.id) ?? 0) + effectKop * l.qty);
  }
  const promoBudgets: PromoBudget[] = [...spent.entries()].map(([termId, spentKop]) => {
    const budget = byId.get(termId)!.budget!;
    return { termId, budget, spent: fromKop(spentKop), exceeded: spentKop > toKop(budget) };
  });
  const warnings = promoBudgets
    .filter((b) => b.exceeded)
    .map((b) => `Бюджет акции «${byId.get(b.termId)!.title}» превышен: расход ${b.spent} ₽ при бюджете ${b.budget} ₽`);

  return {
    customerId,
    date,
    lines,
    total: fromKop(totalKop),
    listTotal: fromKop(listKop),
    savings: fromKop(listKop - totalKop),
    promoBudgets,
    warnings,
  };
}
