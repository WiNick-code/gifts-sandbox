// Загрузка каталога и правил с диска (только Node). Ядро движка от файловой системы не зависит,
// поэтому его же можно будет запускать в браузере и на сервере.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Catalog, Customer, DocumentRef, Product, Term } from './types.ts';

interface RuleFile {
  document?: DocumentRef;
  terms: Term[];
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

function listJson(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return listJson(p);
      return name.endsWith('.json') ? [p] : [];
    });
}

export function loadCatalog(root: string): Catalog {
  const products = readJson<Product[]>(join(root, 'seed/products.json'));
  const customers = readJson<Customer[]>(join(root, 'seed/customers.json'));
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
  };
}
