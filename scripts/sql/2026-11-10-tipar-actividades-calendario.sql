-- Tipar las actividades del calendario que alimentan PDT 601, PDT 621 y Siscont balances.
--
-- Problema: esas plantillas estaban con tipo `nps` y sin grupo de dígitos de RUC, así que el sistema no encontraba
-- su fecha límite (PDT 621 salía «Sin fecha límite configurada», nunca vencido) y, aun tipadas, todas habrían sido
-- «comodín» (aplican a todas las empresas) y se habría usado siempre la más temprana.
--
-- Qué hace (repetible: se puede correr varias veces con el mismo resultado):
--   1. Plantillas (activity_templates): fija el tipo y el grupo de dígitos. Afecta a los calendarios que se creen de ahora en adelante.
--   2. Actividades YA creadas de los calendarios (finance_calendar_activities): copia lo mismo a sus «snapshots»,
--      porque el calendario congela el tipo y los dígitos al crearse.
-- No toca fechas, reglas de cumplimiento ni ninguna otra plantilla. Se identifica por CÓDIGO de plantilla (ACn).
--
-- Correspondencia (según el nombre de cada plantilla):
--   PDT 621          AC9..AC14  «Declaración y envío de liquidación de impuestos RUC 0 / 1 / 2 y 3 / 4 y 5 / 6 y 7 / 8 y 9»
--   PDT 601          AC4, AC6   «Declaración de planillas RUC 0 al 4 / 5 al 9»                      (probable, por confirmar)
--   Siscont balances AC16..AC27 «Asist. balances 2026 RUC 0..9»                                      (probable, por confirmar)
-- SIN TOCAR (pendiente de confirmar): «Informe detracciones» (módulo) y «Compras y ventas Siscont».
--
-- Uso:  mysql -h… -u… -p BASE < 2026-11-10-tipar-actividades-calendario.sql

START TRANSACTION;

DROP TEMPORARY TABLE IF EXISTS _tipar_map;
CREATE TEMPORARY TABLE _tipar_map (
  code VARCHAR(20) NOT NULL PRIMARY KEY,
  tipo VARCHAR(30) NOT NULL,
  d1   INT NOT NULL,
  d2   INT NOT NULL
);

INSERT INTO _tipar_map (code, tipo, d1, d2) VALUES
  ('AC9',  'pdt_621', 0, 0),
  ('AC10', 'pdt_621', 1, 1),
  ('AC11', 'pdt_621', 2, 3),
  ('AC12', 'pdt_621', 4, 5),
  ('AC13', 'pdt_621', 6, 7),
  ('AC14', 'pdt_621', 8, 9),
  ('AC4',  'pdt_601', 0, 4),
  ('AC6',  'pdt_601', 5, 9),
  ('AC16', 'siscont_balances', 0, 0),
  ('AC18', 'siscont_balances', 1, 1),
  ('AC19', 'siscont_balances', 2, 2),
  ('AC21', 'siscont_balances', 3, 3),
  ('AC22', 'siscont_balances', 4, 4),
  ('AC23', 'siscont_balances', 5, 5),
  ('AC24', 'siscont_balances', 6, 6),
  ('AC25', 'siscont_balances', 7, 7),
  ('AC26', 'siscont_balances', 8, 8),
  ('AC27', 'siscont_balances', 9, 9);

-- Control: todas las plantillas del mapa deben existir (si falta alguna, el resultado no coincide con el esperado).
SELECT COUNT(*) AS plantillas_en_mapa FROM _tipar_map;
SELECT COUNT(*) AS plantillas_en_mapa_que_existen
FROM activity_templates t JOIN _tipar_map m ON m.code COLLATE utf8mb4_general_ci = t.code COLLATE utf8mb4_general_ci WHERE t.deleted_at IS NULL;

UPDATE activity_templates t
JOIN _tipar_map m ON m.code COLLATE utf8mb4_general_ci = t.code COLLATE utf8mb4_general_ci
SET t.activity_type = m.tipo, t.ruc_digit_start = m.d1, t.ruc_digit_end = m.d2
WHERE t.deleted_at IS NULL;

UPDATE finance_calendar_activities a
JOIN activity_templates t ON t.id = a.activity_template_id
JOIN _tipar_map m ON m.code COLLATE utf8mb4_general_ci = t.code COLLATE utf8mb4_general_ci
SET a.activity_type_snapshot = m.tipo, a.ruc_digit_start_snapshot = m.d1, a.ruc_digit_end_snapshot = m.d2
WHERE a.deleted_at IS NULL;

-- Resultado: actividades por calendario y tipo (de lo que acabamos de tipar).
SELECT c.period_ym AS periodo, a.activity_type_snapshot AS tipo, COUNT(*) AS actividades
FROM finance_calendar_activities a
JOIN finance_calendars c ON c.id = a.calendar_id AND c.deleted_at IS NULL
WHERE a.deleted_at IS NULL AND a.activity_type_snapshot IN ('pdt_621', 'pdt_601', 'siscont_balances')
GROUP BY c.period_ym, a.activity_type_snapshot
ORDER BY c.period_ym, a.activity_type_snapshot;

COMMIT;
