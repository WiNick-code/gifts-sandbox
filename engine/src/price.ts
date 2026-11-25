import type { Candidate, CartLine, Catalog, Customer, ISODate, PricedCart, PricedLine, Term } from './types.ts';
import { fromKop, toKop } from './money.ts';
import { applyEffect, describeEffect, isActive, matchesCustomer, matchesProduct, specificity } from './terms.ts';

/**
 * Правила расчёта цены строки:
 * 1. Прайсовая цена — отправная точка.
 * 2. Договорная цена клиента: из действующих условий договора выбирается одно —
 *    с наибольшим приоритетом, затем самое точное (SKU > категория > всё), затем самое позднее
 *    (более позднее допсоглашение перекрывает предыдущее).
 * 3. Каждая действующая акция считает цену от прайса или от договорной цены (поле base).
 * 4. Клиент получает минимальную цену из договорной и акционных. Когда акция заканчивается,
 *    она просто перестаёт быть кандидатом — цена автоматически возвращается к договорной.
 */
export function priceLine(catalog: Catalog, customer: Customer, line: CartLine, date: ISODate): PricedLine {
  const product = catalog.products.get(line.sku);
  if (!product) throw new Error(`Товар ${line.sku} не найден в каталоге`);

  const listKop = toKop(product.listPrice);
  const candidates: Candidate[] = [];

  const relevant = catalog.terms.filter(
    (t) => isActive(t, date) && matchesProduct(t, product) && matchesCustomer(t, customer),
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
    options.push({ kop: applyEffect(t.effect, base), term: t, source: 'promo' });
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
    applied: {
      termId: best.term?.id ?? null,
      title: best.term?.title ?? 'Прайс',
      source: best.source,
      document: best.term?.document,
    },
    candidates,
  };
}

const order = (s: Candidate['status']) => (s === 'applied' ? 0 : s === 'rejected' ? 1 : 2);

export function priceCart(catalog: Catalog, customerId: string, cart: CartLine[], date: ISODate): PricedCart {
  const customer = catalog.customers.get(customerId);
  if (!customer) throw new Error(`Клиент ${customerId} не найден`);
  const lines = cart.map((l) => priceLine(catalog, customer, l, date));
  const totalKop = lines.reduce((s, l) => s + toKop(l.total), 0);
  const listKop = lines.reduce((s, l) => s + toKop(l.listPrice) * l.qty, 0);
  return {
    customerId,
    date,
    lines,
    total: fromKop(totalKop),
    listTotal: fromKop(listKop),
    savings: fromKop(listKop - totalKop),
  };
}
