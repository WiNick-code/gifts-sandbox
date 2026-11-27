// Загрузка каталога и правил с диска (только Node). Ядро движка от файловой системы не зависит,
// поэтому его же можно будет запускать в браузере и на сервере.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Catalog, Customer, DocumentRef, Product, Term } from './types.ts';
import { buildTermIndex } from './terms.ts';

interface RuleFile {
  document?: DocumentRef;
  terms: Term[];
}

// Файл-контракт с учётной системой: какие поля 1С УТ приходят в карточку товара.
interface MappingFile {
  source: string;
  required: Record<string, string>;
  optional: Record<string, string>;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

function listJson(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      // «._*» — служебные файлы macOS (AppleDouble): на внешних дисках плодятся рядом с настоящими.
      if (name.startsWith('._')) return [];
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return listJson(p);
      return name.endsWith('.json') ? [p] : [];
    });
}

// Карточка товара обязана иметь все поля из блока required маппинга — иначе данные из 1С пришли неполными.
export function checkMapping(mapping: MappingFile, products: Product[]): void {
  const missing = Object.keys(mapping.required).filter((field) => products.some((p) => p[field as keyof Product] == null));
  if (missing.length)
    throw new Error(
      `Карточки товаров неполные (${mapping.source}): отсутствуют поля [${missing.join(', ')}], назначенные в seed/1c-mapping.json`,
    );
}

export function loadCatalog(root: string): Catalog {
  const products = readJson<Product[]>(join(root, 'seed/products.json'));
  const customers = readJson<Customer[]>(join(root, 'seed/customers.json'));
  const mapping = readJson<MappingFile>(join(root, 'seed/1c-mapping.json'));
  checkMapping(mapping, products);

  const terms: Term[] = [];
  for (const file of listJson(join(root, 'rules'))) {
    const data = readJson<RuleFile>(file);
    for (const t of data.terms ?? []) {
      terms.push({ ...t, document: t.document ?? data.document, origin: relative(root, file) });
    }
  }
  return {
    products: new Map(products.map((p) => [p.sku, p])),
    customers: new Map(customers.map((c) => [c.id, c])),
    terms,
    index: buildTermIndex(terms),
  };
}
