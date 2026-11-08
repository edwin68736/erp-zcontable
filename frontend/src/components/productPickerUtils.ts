import type { Product } from '../services/products';

export function productLabel(p: Product): string {
  const n = p.name?.trim();
  if (n) return n;
  return p.description?.trim() || `Ítem #${p.id}`;
}

export function productUnitPrice(p: Product): number {
  const fromSale = Number(String(p.sale_unit_price ?? '').replace(',', '.'));
  if (Number.isFinite(fromSale) && fromSale > 0) return fromSale;
  if (Number.isFinite(p.price) && p.price > 0) return p.price;
  return 0;
}

export function sortProductsAlphabetically(list: Product[]): Product[] {
  return [...list].sort((a, b) =>
    productLabel(a).localeCompare(productLabel(b), 'es', { sensitivity: 'base' }),
  );
}
