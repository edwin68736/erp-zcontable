-- Reportes post-consolidación DEU-LIQ (solo lectura)
-- Ejecutar: mysql -u user erp_zcontable < scripts/debt_consolidation_report.sql

SELECT '=== ESTADO LEGACY ===' AS section;

SELECT legacy_status, COUNT(*) AS cnt
FROM documents
WHERE deleted_at IS NULL AND number LIKE 'DEU-LIQ-%'
GROUP BY legacy_status;

SELECT '=== FUSIONES (merge_legacy / merge_duplicate_group) ===' AS section;

SELECT l.id, l.action, l.legacy_document_id, dl.number AS legacy_number,
       l.canonical_document_id, dc.number AS canonical_number, l.applied_at
FROM document_consolidation_logs l
LEFT JOIN documents dl ON dl.id = l.legacy_document_id
LEFT JOIN documents dc ON dc.id = l.canonical_document_id
WHERE l.action IN ('merge_legacy', 'merge_duplicate_group', 'archive_duplicate_group')
ORDER BY l.id;

SELECT '=== REVERSIONES FUSIÓN INCORRECTA ===' AS section;

SELECT l.id, l.legacy_document_id, dl.number AS legacy_number,
       l.canonical_document_id, l.details_json, l.applied_at
FROM document_consolidation_logs l
LEFT JOIN documents dl ON dl.id = l.legacy_document_id
WHERE l.action = 'revert_wrong_merge'
ORDER BY l.id;

SELECT '=== CONFLICTOS (si existieran) ===' AS section;

SELECT l.legacy_document_id, dl.number, l.details_json, l.applied_at
FROM document_consolidation_logs l
LEFT JOIN documents dl ON dl.id = l.legacy_document_id
WHERE l.migration_name = 'documents_v3_legacy_consolidation'
  AND l.action = 'conflict'
ORDER BY l.id;

SELECT '=== PROMOCIONES (muestra) ===' AS section;

SELECT d.id, d.number, d.tax_settlement_id, d.total_amount, d.balance_amount, d.status
FROM documents d
WHERE d.deleted_at IS NULL AND d.legacy_status = 'legacy_promoted'
ORDER BY d.id
LIMIT 30;
