import { parseTaxSectionsJson, type TaxSettlementSectionsPayload } from '../../utils/taxSettlementSections';

export function hasTaxSectionsData(pdt621Json?: string | null): boolean {
  const s = parseTaxSectionsJson(pdt621Json) as TaxSettlementSectionsPayload | null;
  if (!s) return false;
  return Boolean(
    s.pdt621?.enabled ||
      s.pdt601?.enabled ||
      s.itan?.enabled ||
      s.pdt617?.enabled ||
      s.bolsas_plasticas?.enabled ||
      s.pdt710?.enabled,
  );
}
