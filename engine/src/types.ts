// Базовые типы движка коммерческих условий.
// В данных цены — в рублях (удобно читать и править), внутри движка — в копейках (целые числа).

export type ISODate = string; // 'YYYY-MM-DD'

export interface Product {
  sku: string;
  name: string;
  category: string;
  listPrice: number; // базовая (прайсовая) цена, руб.
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

// «Токен» условия: одна атомарная коммерческая договорённость.
export interface Term {
  id: string;
  title: string;
  source: 'contract' | 'promo';
  effect: TermEffect;
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
}

export interface CartLine {
  sku: string;
  qty: number;
}

export interface Catalog {
  products: Map<string, Product>;
  customers: Map<string, Customer>;
  terms: Term[];
}

export type CandidateStatus = 'applied' | 'rejected' | 'not_eligible';

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
  applied: { termId: string | null; title: string; source: Candidate['source']; document?: DocumentRef };
  candidates: Candidate[];
}

export interface PricedCart {
  customerId: string;
  date: ISODate;
  lines: PricedLine[];
  total: number;
  listTotal: number;
  savings: number; // выгода клиента относительно прайса, руб.
}
