// Базовые типы движка коммерческих условий.
// В данных цены — в рублях (удобно читать и править), внутри движка — в копейках (целые числа).

export type ISODate = string; // 'YYYY-MM-DD'

// Карточка товара: то, что приходит из учётной системы (см. seed/1c-mapping.json —
// соответствие полей 1С УТ полям движка) и описательная часть для витрины и CRM.
export interface Product {
  sku: string;
  name: string;
  category: string;
  listPrice: number; // базовая (прайсовая) цена, руб.
  cost: number; // себестоимость, руб. — из учётной системы; нужна для ограничителей маржи
  unit?: string; // единица: «шт.», «компл.» — иначе «шт.»
  description?: string; // описательная часть для витрины/CRM
  attributes?: Record<string, string>; // характеристики: материал, цвет, бренд...
}

export type PaymentTerms =
  | { type: 'prepay' } // 100% предоплата
  | { type: 'deferral'; days: number } // отсрочка без лимита
  | { type: 'deferral_limit'; days: number; limit: number }; // отсрочка с кредитным лимитом, руб.

export interface Customer {
  id: string;
  name: string;
  segment: string; // например: agency, reseller, corporate
  payment: PaymentTerms;
}

// Ссылка на документ-основание (договор / допсоглашение / приказ об акции) — живёт в ЭДО.
export interface DocumentRef {
  type: 'contract' | 'addendum' | 'promo_order';
  number: string;
  date: ISODate;
}

export type TermEffect =
  | { type: 'percent_off'; percent: number } // скидка, %
  | { type: 'amount_off'; amount: number } // скидка, руб. за единицу
  | { type: 'fixed_price'; price: number }; // фиксированная цена, руб. за единицу

// Механика акции — именованный пресет параметров: «что делает акция и от чего считается».
// Комбинаций условий немного, поэтому механики — справочник, а не свободная форма:
// акция ссылается на механику (term.mechanic) и наследует её настройки, если не задала свои.
export interface MechanicPreset {
  id: string; // короткое имя-код: percent-off, fixed-price...
  title: string;
  description: string;
  effect: TermEffect; // что делает: скидка %, скидка ₽/шт., фиксированная цена
  base?: 'list' | 'contract'; // от какой цены считается
  archived?: boolean; // в архиве: в конструкторе акции не предлагается, у существующих акций остаётся
}

// «Токен» условия: одна атомарная коммерческая договорённость.
export interface Term {
  id: string;
  title: string;
  source: 'contract' | 'promo';
  effect: TermEffect;
  // Механика акции, по которой создано условие (заполняется конструктором акций; для
  // договорных условий смысла не имеет). Наследует effect/base механики, если задана.
  mechanic?: string;
  // От какой цены считается акция: от прайсовой (по умолчанию) или от договорной клиента.
  base?: 'list' | 'contract';
  scope: { all?: boolean; skus?: string[]; categories?: string[]; excludeSkus?: string[] };
  audience: { all?: boolean; customerIds?: string[]; segments?: string[] };
  validFrom: ISODate;
  validTo?: ISODate; // включительно; нет даты — бессрочно
  minQty?: number;
  priority?: number; // больше — важнее
  document?: DocumentRef;
  origin?: string; // файл, из которого загружено условие (заполняет загрузчик)
  // Ограничители (только для акций; без них ограничитель не действует).
  minMargin?: number; // минимальная маржа, % от себестоимости; блокирует цену ниже порога
  maxQtyPerOrder?: number; // лимит штук в одном заказе; блокирует строку сверх лимита
  budget?: number; // бюджет акции, руб.; предупреждение при превышении (учётный, не блокирующий)
}

// Инвертированный индекс условий: на больших каталогах выборка «условия, относящиеся
// к товару» не должна перебирать все условия. Строится один раз на загруженный набор.
export interface TermIndex {
  bySku: Map<string, Term[]>;
  byCategory: Map<string, Term[]>;
  global: Term[]; // условия с охватом «весь ассортимент»
  excluded: Map<string, Term[]>; // sku → условия, явно исключившие этот sku
}

export interface CartLine {
  sku: string;
  qty: number;
}

export interface Catalog {
  products: Map<string, Product>;
  customers: Map<string, Customer>;
  terms: Term[];
  mechanics?: Map<string, MechanicPreset>; // справочник механик акций (seed/presets.json)
  index?: TermIndex; // строится загрузчиком; без него — линейный перебор (мало условий)
  disabledPromos?: ReadonlySet<string>; // id акций, принудительно отключённых из админки:
  // условия акции при этом не меняются — это слой состояния поверх правил (в бою — таблица в БД,
  // в песочнице — localStorage браузера админа, см. web/admin.html)
}

export type CandidateStatus = 'applied' | 'rejected' | 'not_eligible' | 'limit';

export interface Candidate {
  termId: string | null; // null — прайсовая цена
  title: string;
  source: 'list' | 'contract' | 'promo';
  unitPrice: number | null; // руб.; null — если условие не применимо
  status: CandidateStatus;
  reason: string;
  document?: DocumentRef;
}

export interface PricedLine {
  sku: string;
  name: string;
  qty: number;
  listPrice: number;
  contractPrice: number;
  unitPrice: number;
  total: number;
  margin: number; // маржа строки: (итоговая цена − себестоимость) × количество, руб.; отрицательная — сигнал убытка
  applied: { termId: string | null; title: string; source: Candidate['source']; document?: DocumentRef };
  candidates: Candidate[];
}

// Расход бюджета акции по корзине: сколько акция «стоит» компании.
export interface PromoBudget {
  termId: string;
  budget: number; // согласованный бюджет, руб.
  spent: number; // скидочный эффект по корзине, руб.
  exceeded: boolean; // бюджет превышен — предупреждение, акция не блокируется
}

export interface PricedCart {
  customerId: string;
  date: ISODate;
  lines: PricedLine[];
  total: number;
  listTotal: number;
  savings: number; // выгода клиента относительно прайса, руб.
  promoBudgets: PromoBudget[]; // по акциям с заданным бюджетом
  warnings: string[]; // предупреждения движка по корзине (превышение бюджета акции)
}
