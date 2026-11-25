import type { Catalog, Term } from './types.ts';

export interface Issue {
  level: 'error' | 'warning';
  termId?: string;
  origin?: string;
  message: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Проверка правил до публикации: ошибки блокируют, предупреждения — повод присмотреться.
export function validateCatalog(catalog: Catalog): Issue[] {
  const issues: Issue[] = [];
  const add = (level: Issue['level'], t: Term | undefined, message: string) =>
    issues.push({ level, termId: t?.id, origin: t?.origin, message });

  const seen = new Map<string, Term>();
  const categories = new Set([...catalog.products.values()].map((p) => p.category));
  const segments = new Set([...catalog.customers.values()].map((c) => c.segment));

  for (const t of catalog.terms) {
    if (seen.has(t.id)) add('error', t, `Дублируется id «${t.id}» (также в ${seen.get(t.id)!.origin})`);
    seen.set(t.id, t);

    if (!DATE.test(t.validFrom)) add('error', t, `Некорректная дата начала «${t.validFrom}»`);
    if (t.validTo && !DATE.test(t.validTo)) add('error', t, `Некорректная дата окончания «${t.validTo}»`);
    if (t.validTo && t.validTo < t.validFrom) add('error', t, 'Дата окончания раньше даты начала');

    const e = t.effect;
    if (e.type === 'percent_off' && (e.percent <= 0 || e.percent >= 100))
      add('error', t, `Скидка ${e.percent}% вне диапазона (0; 100)`);
    if (e.type === 'amount_off' && e.amount <= 0) add('error', t, 'Скидка в рублях должна быть больше нуля');
    if (e.type === 'fixed_price' && e.price <= 0) add('error', t, 'Фиксированная цена должна быть больше нуля');

    const s = t.scope;
    if (!s.all && !s.skus?.length && !s.categories?.length) add('error', t, 'Не задан охват товаров (scope)');
    for (const sku of [...(s.skus ?? []), ...(s.excludeSkus ?? [])])
      if (!catalog.products.has(sku)) add('error', t, `Товар ${sku} отсутствует в каталоге`);
    for (const c of s.categories ?? []) if (!categories.has(c)) add('warning', t, `Категория «${c}» пуста`);

    const a = t.audience;
    if (!a.all && !a.customerIds?.length && !a.segments?.length) add('error', t, 'Не задана аудитория (audience)');
    for (const id of a.customerIds ?? []) if (!catalog.customers.has(id)) add('error', t, `Клиент ${id} не найден`);
    for (const sg of a.segments ?? []) if (!segments.has(sg)) add('warning', t, `Сегмент «${sg}» без клиентов`);

    if (t.source === 'contract' && a.all) add('warning', t, 'Условие договора адресовано всем клиентам — это точно не акция?');
    if (t.source === 'contract' && !t.document) add('warning', t, 'Условие договора без ссылки на документ ЭДО');
    if (t.source === 'promo' && !t.validTo) add('warning', t, 'Бессрочная акция — задайте дату окончания');
    if (e.type === 'fixed_price')
      for (const sku of s.skus ?? []) {
        const p = catalog.products.get(sku);
        if (p && e.price >= p.listPrice) add('warning', t, `Фиксированная цена ${e.price} ₽ не ниже прайса ${p.listPrice} ₽ для ${sku}`);
      }
  }

  // Неоднозначность: два условия договора с одинаковым приоритетом, охватом и датой начала.
  const contracts = catalog.terms.filter((t) => t.source === 'contract');
  for (let i = 0; i < contracts.length; i++)
    for (let j = i + 1; j < contracts.length; j++) {
      const x = contracts[i], y = contracts[j];
      if (
        x.validFrom === y.validFrom &&
        (x.priority ?? 0) === (y.priority ?? 0) &&
        JSON.stringify(x.scope) === JSON.stringify(y.scope) &&
        JSON.stringify(x.audience) === JSON.stringify(y.audience)
      )
        add('warning', y, `Неоднозначно с «${x.id}»: одинаковые охват, аудитория, приоритет и дата начала`);
    }

  return issues;
}
