# Reglas de cumplimiento — snapshot de `activity_rule_id`

Documentación técnica del comportamiento actual. **No hay versionado de reglas.**

## Qué se congela al crear una actividad de calendario

Al ejecutar `CreateActivity` (o duplicar un calendario), el sistema copia desde la plantilla:

```text
activity_templates.activity_rule_id  →  finance_calendar_activities.activity_rule_id
```

Ese valor es un **snapshot del identificador** en el momento de la creación.

- Cambiar la regla asignada en la plantilla **no modifica** actividades de calendario ya existentes.
- Editar días o estado operativo de una actividad **no modifica** su `activity_rule_id`.

## Limitación explícita (diseño actual)

El snapshot **solo congela `activity_rule_id`**. **No** se copian ni congelan los parámetros internos de la regla:

| Campo en `activity_rules` | ¿Congelado en calendario? |
|---------------------------|---------------------------|
| `compare_mode`            | No — se lee en runtime    |
| `max_upload_time`         | No — se lee en runtime    |
| `grace_days`              | No — se lee en runtime    |
| `active`                  | No — `LoadActiveActivityRule` exige regla activa |

En runtime, el flujo es:

```text
finance_calendar_activities.activity_rule_id
    → LoadActiveActivityRule(id)
    → activity_rules (valores actuales)
    → BuildUploadDeadline / EvaluateUploadTimeliness
```

Por tanto:

- **Editar** una regla (p. ej. aumentar `grace_days`) afecta el cumplimiento de **todas** las actividades de calendario que apuntan a ese ID, incluidas las creadas antes del cambio.
- **Desactivar** o eliminar (soft) una regla hace que esas actividades evalúen como `no_rule` aunque conserven el ID en el snapshot.

Esto es intencional en la arquitectura vigente: una sola entidad regla reutilizable, referenciada por ID. No se implementa versionado ni snapshot de parámetros.

## Qué no hace el calendario

- No hay selector de regla en la UI del calendario.
- No se re-sincroniza `activity_rule_id` desde la plantilla en `UpdateActivity`.

## Verificación de backfill

Comando read-only (no modifica la base de datos):

```bash
go run ./cmd/activity-rule-backfill-audit
go run ./cmd/activity-rule-backfill-audit -json
```

Detecta:

- actividades sin `activity_rule_id`;
- plantillas con regla cuyas actividades de calendario no tienen snapshot;
- referencias a reglas inexistentes.

## Tests automatizados relacionados

En `services/finance_calendar_service_test.go`:

- `TestCreateActivity_CopiesActivityRuleIDFromTemplate`
- `TestSetActivityRule_DoesNotModifyExistingCalendarActivities`
