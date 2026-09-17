# Diseño: limpieza de funcionalidades sin uso en el detalle de control (SupervisorControlDetail)

**Fecha**: 2026-09-16. **Documento vivo** — se va ampliando sección por sección a medida que
revisamos cada parte de `frontend/src/pages/supervisors/SupervisorControlDetail.tsx`
(`/supervisors/controls/:id`, también accesible como `/assistant/controls/:id`). Cualquier cambio de
criterio respecto a lo acá escrito debe reflejarse acá mismo, no solo quedar en el chat. Nada de lo
documentado acá se implementa hasta que quede marcado como decidido y confirmado.

**Todos los números de este documento fueron verificados dos veces**: primero contra la base de datos
local (dev), y luego contra la base de datos real de producción en el VPS (`ssh vps-zcontable`,
contenedor `erp-zcontable-mysql-1`, base `sistema`, acceso de solo lectura). Donde los números
difieren entre dev y producción, se indican los dos.

## 0. Contexto — por qué existe este documento

Esta vista tiene 4 pestañas: **Declaraciones, Liquidación, NPS, Historial**. Surgió al revisar el
dashboard de Supervisores (ver `nps-sunat-feature-sin-uso.md` en memoria) y notar que la tarjeta
"Pagos SUNAT" siempre muestra 0. Investigar esa tarjeta llevó a esta vista completa, y de ahí a un
hallazgo más grande e importante que la vista misma: una brecha de configuración que afecta
directamente el rediseño de estados PDT601/621 que se acaba de implementar (ver Sección 2).

**Diagnóstico general de las 4 pestañas** (detalle completo en el chat, resumen acá):

| Pestaña | Estado |
|---|---|
| Declaraciones | Editable hoy, no debería serlo — ver Sección 3 |
| Liquidación | Confirmado real, no es duplicado de nada — fuera de alcance de esta limpieza |
| ~~NPS~~ | ~~Muerta~~ — **eliminada (Sección 1, implementado 2026-09-17)** |
| Historial | Confirmado real (con un hueco menor) — ver Sección 3.4, fuera de alcance de cambios |

## 1. Decisión: eliminar el tracking de "Nota de Pago SUNAT" (NPS)

### 1.1 Evidencia de que no se usa — confirmada en dev Y en producción

| | Dev (local) | **Producción (VPS)** |
|---|---|---|
| Filas en `supervisor_nps` | 0 | **0** |
| Empresas reales activas | 255 | **328** |
| Declaraciones reales (`supervisor_declarations`) | 6140 | **5524** |
| Controles mensuales reales | 1530 | **1382** |

Con 328 empresas y meses de uso real en producción, `supervisor_nps` sigue en 0 filas — no es un
artefacto de la copia de desarrollo. El feature nunca se usó, ni una vez, ni en dev ni en producción.

- No está en el sidebar de Supervisores/Asistente (`frontend/src/navigation/sidebarConfig.ts`) — solo
  se llega por un clic desde una fila del Dashboard, Reportes, o el Calendario financiero.
- El propio doc interno `backend/docs/guia-supervisores-registro.md:73` llama a la ruta que la
  contiene **"legacy"**, ya reemplazada en la práctica por los 4 módulos de actividad (Buzón SOL,
  Detracciones, PDT 601, PDT 621).
- El campo "NPS" que sí se usa en el formulario de PDT 601 (OK/Detracciones/Parcial Detracc/No
  corresponde) **no tiene relación** con esta tabla — es un campo homónimo, confirmado sin ningún JOIN
  ni referencia cruzada entre ambos.

### 1.2 Arquitectura confirmada — los dos calendarios, y por qué tocar "nps" no afecta a PDT601/621

Confirmado con el usuario y verificado en código — son dos sistemas sin ninguna tabla ni código en
común:

- **Calendario SUNAT** (`sunat_due_date_calendar_rows`, 12 filas fijas, una por mes): puramente
  informativo, página `/finance/sunat-due-dates`. Solo lo usa `pdt621ScheduleDueDate` para un campo
  específico y aparte (`DeclarationTimeliness`, puntualidad de la declaración REAL ante SUNAT por
  dígito de RUC) — no participa en nada de lo que se discute en este documento.
- **Calendario de actividades** (el interno, `/finance/calendar`): `ActivityTemplate` (plantilla
  reutilizable) → `FinanceCalendar` (una fila por período/mes, sin empresa) → `FinanceCalendarActivity`
  (instancia de una plantilla en un período, con su propia "foto" congelada de tipo/nombre — sin
  columna de empresa tampoco). El cumplimiento se evalúa **en vivo, por empresa**, recién cuando
  alguien abre el panel "Cumplimiento" de una actividad — la misma fila de actividad se reutiliza para
  las 328 empresas.

`pdt601PeriodDueDate`/`pdt621PeriodDueDate` (usadas para "Entregado a tiempo" vs. "Entregado fuera de
fecha") buscan la actividad del calendario filtrando **literalmente por
`activity_type_snapshot = 'pdt_601'`/`'pdt_621'`**. Es un filtro completamente disjunto del caso
`'nps'` que se plantea eliminar acá — son ramas separadas de un mismo `switch` en
`finance_calendar_service.go` (función `companyCompliance`, líneas 666-729), y esa función ni siquiera
es la misma que resuelve la fecha límite de PDT601/621. **Conclusión: quitar/redirigir el caso "nps"
de ese switch no puede afectar de ninguna forma el rediseño de estados PDT601/621.** También se
confirmó que el tipo `"payment"` tiene **0 plantillas y 0 instancias** en dev y producción — ni
siquiera existe, así que ese caso tampoco tiene ningún uso real que proteger.

### 1.3 El tipo de actividad "nps" del Calendario financiero está mal usado y genera vencimientos falsos

| | Dev (local) | **Producción (VPS)** |
|---|---|---|
| Plantillas (`activity_templates`) tipadas `nps` | 31 de ~38 | **33 de 35** |
| Plantillas tipadas `other` | 4 | **2** |
| Plantillas tipadas `pdt_601`/`pdt_621`/`detracciones`/`sire`/`sunat_inbox` | 1/1/1/0/0 | **0/0/0/0/0** |
| Instancias de calendario (`finance_calendar_activities`) tipadas `nps` | 153 | **165** |
| Instancias tipadas `other` | pocas | **6** |

En producción la situación es **peor que en dev**: prácticamente todo el catálogo de plantillas
(33 de 35) quedó tipado "nps", con nombres que no tienen nada que ver con notas de pago SUNAT —
`ASIST. BALANCES 2026 RUC 0-9`, `DECLARACION DE PLANILLAS RUC 0 AL 4/5 AL 9`, `DECLARACION Y ENVIO DE
LIQUIDACION DE IMPUESTOS RUC 0/1/2y3/4y5/6y7/8y9`, `DESCARGA E IMPRESIÓN DE ESTADOS DE CTA
DETRACCIONES`, `REVISION DE BUZON ELECTRONICO SUNAT Y SUNAFIL`, `COMPRAS Y VENTAS SISCONT`,
`FERIADO`, `PRELIMINAR DE VENTAS`, `CALCULO DE GRATIFICACIONES`, `INFORME DE DEUDAS`, `DECLARACION
BENEFICIARIO FINAL`, `PLANILLAS DEL MES CON TAREO`, `INFORME DETRACCIONES`, `ENVIO DE NPS Y BOLETAS DE
TRABAJADORES`, entre otras. Todo indica que "nps" quedó como valor por defecto/genérico al crear estas
plantillas, no a propósito.

`finance_calendar_service.go:678-692` calcula si una actividad tipo `nps` está "completada"
consultando `supervisor_nps` por `monthly_control_id`. Como esa tabla está siempre vacía, el resultado
es **siempre** `"vencida" / "Sin NPS registrados"` — sin importar si la tarea real (ej. "BALANCES" de
esa empresa/período) se hizo o no. **Impacto**: 165 instancias de calendario en producción se muestran
como vencidas de forma permanente y falsa cada vez que alguien abre su panel de Cumplimiento.

### 1.4 Alcance — qué se tocaría si se aprueba

**Backend**:
- Modelo `SupervisorNPS` y constantes de estado (`backend/models/supervisor.go`).
- Servicios: `CreateNPS`, `UpdateNPS`, `GenerateNPS`, `RegisterNPSPayment`, `DeleteNPS`, `ListNPS`,
  `SyncOverdueNPS` (`backend/services/supervisor_service.go`, `supervisor_audit.go`).
- `SyncOverdueNPS` está enganchado a `RunMonthlyAutomations` (cron ~6h) — hay que sacarlo de ahí.
- Controladores y rutas: `ListNPSAPI/CreateNPSAPI/UpdateNPSAPI/GenerateNPSAPI/RegisterNPSPaymentAPI/DeleteNPSAPI`
  (`supervisor_controller.go`), rutas de NPS en `routes.go` (líneas 236-240 y 249 — **ese rango no es
  un bloque contiguo**, las líneas 241-248 son rutas de otras cosas —`reports/monthly`, `history`,
  `observations`, `attachments`, `notifications`— que no se tocan; hay que borrar las líneas de NPS una
  por una, no el bloque completo).
- `Dashboard()` (`supervisor_service.go:412-430`): quitar `qNPS`/`qPay` y los campos
  `NPSPending`/`PaymentsPending` de `SupervisorDashboard`.
- `finance_calendar_service.go:678-708`: quitar los `case CalendarActivityNPS` y
  `case CalendarActivityPayment` del switch de estado — caerían al `default` ("Seguimiento manual"),
  igual que otras actividades tipo "other" (FERIADO, PLANILLA genérica).
- RBAC: quitar `supervisors.nps_view/create/update/delete/generate/register_payment` de
  `backend/rbac/codes.go` y de todos los sets de roles en `backend/rbac/registry.go`.
- Notificación `nps_ready` (disparada desde `GenerateNPS`) deja de existir junto con la función.

**Frontend**:
- Pestaña "NPS" completa en `SupervisorControlDetail.tsx` (tab, imports de tipos, permisos
  `canNps*`, todo el bloque de renderizado).
- `frontend/src/services/supervisors.ts`: tipo `SupervisorNPS`, métodos `listNPS/createNPS/updateNPS/generateNPS/registerNPSPayment/deleteNPS`.
- `frontend/src/rbac/codes.ts`: códigos `supervisorsNPS*`.
- `SupervisorDashboard.tsx`: tarjetas "NPS pendientes" y "Pagos SUNAT" (`data.nps_pending`,
  `data.payments_pending`).
- `SupervisorReports.tsx`: el tipo de reporte `nps_pending`/`payments_pending` (`SupervisorReportKind`)
  y sus columnas — **a confirmar si se elimina el tipo de reporte entero o solo dejar de generarlo**
  (ver §1.5, punto 3).

**Base de datos**: la tabla `supervisor_nps` en sí — **a decidir** si se deja huérfana (sin código que
la referencie, sin DROP) o se elimina con una migración.

### 1.5 Decisiones

1. ✅ **DECIDIDO (2026-09-17)**: las 33 plantillas mal tipadas como "nps" se **re-tipean
   explícitamente** (no basta con que caigan a "Seguimiento manual" por defecto) — conectado con la
   Sección 2, varias pasan a `pdt_601`/`pdt_621`/`detracciones`/`sunat_inbox` según el mapeo de §2.3, el
   resto a `other`.
2. ✅ **DECIDIDO (2026-09-17)**: la tabla `supervisor_nps` se **elimina por completo**, junto con todo
   su código (modelo, servicios, controladores, rutas, RBAC, cron) — no se deja huérfana.
3. ✅ **DECIDIDO (2026-09-17)**: se **elimina** el tipo de reporte `nps_pending`/`payments_pending` de
   `SupervisorReports.tsx` (ya confirmado sin uso real).
4. ✅ **DECIDIDO (2026-09-17)**: orden de implementación — backend primero, luego frontend.

### 1.6 Checklist de implementación

- [x] Backend: quitar modelo, servicios, controladores, rutas (líneas de NPS en `routes.go`, no el
      rango completo — ver §1.4), RBAC, cron — **hecho 2026-09-17**
- [x] Backend: quitar casos NPS/Payment del switch de `finance_calendar_service.go` — **hecho**
- [x] Backend: migración `DROP TABLE supervisor_nps` escrita (`migrateDropNPSTable`,
      `backend/database/supervisor_migrations.go`) — corre sola al reiniciar el backend; **aún no
      desplegada** (no se hizo push)
- [x] Frontend: quitar pestaña NPS, tipos, permisos — **hecho**
- [x] Frontend: quitar tarjetas del dashboard — **hecho**
- [x] Frontend: quitar el reporte `nps_pending`/`payments_pending` de `SupervisorReports.tsx` — **hecho**
- [x] Frontend: quitar `nps`/`payment` del selector de tipos del catálogo
      (`frontend/src/pages/finance/calendar/calendarUtils.ts`, `ACTIVITY_KINDS`) — hallazgo adicional
      durante la implementación, no estaba en el alcance original de §1.4 pero era necesario para que
      el frontend no siga ofreciendo un tipo que el backend ya no acepta
- [ ] **Retipear las ~25 plantillas "nps" que NO son pdt_601/pdt_621** (las 8 de ese mapeo están en el
      checklist de §2.8) — pendiente, se hace junto con el retipeo de Sección 2, no antes (mismo
      trabajo de catálogo, una sola pasada)
- [x] Verificar: `go build`/`go test`, `tsc`/`npm run build` — **todo limpio**
- [ ] Probar en navegador: Calendario financiero ya no debe mostrar las 165 actividades "nps" como
      vencidas por defecto — pendiente de desplegar + retipeo para verse reflejado en producción

**Nota**: `backend/docs/guia-supervisores-registro.md` (líneas ~265-275) todavía documenta la pestaña
NPS como si existiera — doc interno desactualizado, no bloqueante, pendiente de limpiar cuando se
retome documentación general (no se tocó en esta pasada).

## 2. HALLAZGO DE MAYOR PRIORIDAD: PDT 601/621 no tienen actividad de calendario propia en producción — "Entregado fuera de fecha" nunca se activa

Este hallazgo apareció investigando el punto 1.3, pero es más importante que la limpieza de NPS en sí,
porque afecta directamente al rediseño de estados PDT601/621 que se acaba de implementar y desplegar.
**Actualizado tras analizar los calendarios reales de junio, julio y agosto 2026 en producción,
actividad por actividad** — el alcance real es mayor al que se había estimado inicialmente: no es solo
un problema de datos, es un vacío de diseño en el código.

### 2.1 El problema

En producción, **cero plantillas de actividad** tienen `activity_type = 'pdt_601'` o `'pdt_621'`
(tabla completa en §1.3). Como `pdt601PeriodDueDate`/`pdt621PeriodDueDate`
(`backend/services/supervisor_pdt601_service.go:200-215`,
`backend/services/supervisor_pdt621_service.go:200-215`) buscan la fecha límite filtrando
exactamente por ese `activity_type`, **nunca encuentran nada** en ningún período de producción.

El propio diseño documenta qué pasa cuando no se encuentra actividad: *"Nil si el período no tiene
esta actividad configurada en el calendario... en ese caso no hay nada contra qué comparar, y tanto el
filtro como el label tratan la entrega como 'a tiempo' (no se castiga por falta de configuración)"*
(`supervisor_pdt601_service.go:196-199`).

**Consecuencia real y actual**: ninguna declaración de PDT 601 o PDT 621 puede llegar a marcarse
"Entregado fuera de fecha" en producción — todo se clasifica como "a tiempo" sin importar la fecha
real de entrega, porque no hay ninguna fecha límite interna configurada contra la cual comparar. La
funcionalidad de puntualidad que se construyó estos últimos días (`entregado`/`entregado_fuera_de_fecha`,
docs/diseno-estados-pdt601-pdt621-2026-09-16.md) está **desplegada y funcionando en el código**, pero
sin datos de configuración reales no tiene ningún efecto visible todavía.

Nota: esto no afecta el `due_date` general del control (`supervisor_monthly_controls.due_date`, que sí
está poblado — confirmado, ej. `2026-10-20` para el período 2026-09) ni la detección de "Vencido" a
nivel de control, que usa otra fuente. Tampoco afecta `DeclarationTimeliness` de PDT 621 (la
puntualidad contra el cronograma SUNAT real, que sí sigue funcionando vía `sunat_due_date_calendar_rows`,
sección 1.2). Lo único inoperante es la puntualidad contra el **calendario interno del estudio**.

### 2.2 CONFIRMADO — PDT 601/621 no son "una actividad", son varias, agrupadas por dígito de RUC

Se analizó actividad por actividad los calendarios reales de junio, julio y agosto 2026 en producción
(`finance_calendar_activities` JOIN `finance_calendars`, ordenado por día de vencimiento). El
resultado confirma exactamente lo que el usuario adelantó — no hay una sola actividad "PDT 601" ni una
sola "PDT 621" por período, hay una **familia de actividades agrupadas por rango de RUC, cada una con
su propia fecha límite dentro del mes**, calcada del mismo criterio de agrupación que usa el
cronograma real de SUNAT:

| Actividad (junio 2026) | Módulo | Grupo de RUC | Día de vencimiento |
|---|---|---|---|
| DECLARACION DE PLANILLAS RUC 0 AL 4 | PDT 601 | dígitos 0-4 | 4 |
| DECLARACION DE PLANILLAS RUC 5 AL 9 | PDT 601 | dígitos 5-9 | 5 |
| LIQUIDACION DE IMPUESTOS RUC 0 | PDT 621 | dígito 0 | 8 |
| LIQUIDACION DE IMPUESTOS RUC 1 | PDT 621 | dígito 1 | 9 |
| LIQUIDACION DE IMPUESTOS RUC 2 Y 3 | PDT 621 | dígitos 2-3 | 10 |
| LIQUIDACION DE IMPUESTOS RUC 4 Y 5 | PDT 621 | dígitos 4-5 | 11 |
| LIQUIDACION DE IMPUESTOS RUC 6 Y 7 | PDT 621 | dígitos 6-7 | 12 |
| LIQUIDACION DE IMPUESTOS RUC 8 Y 9 | PDT 621 | dígitos 8-9 | 15 |

**PDT 601 = 2 grupos, PDT 621 = 6 grupos.** El mismo patrón se repite en julio y agosto (con
pequeñas variaciones de día por fin de semana/feriados).

**Esto ya no es una pregunta abierta, es un hecho confirmado que cambia el alcance de la corrección**:
`pdt601PeriodDueDate`/`pdt621PeriodDueDate` y `findPdt601CalendarActivity`/`findPdt621CalendarActivity`
(`FindCalendarActivityByType`, que trae la PRIMERA actividad que matchea el tipo, asumiendo que hay una
sola) están diseñadas para una única fecha límite por período — un diseño incompatible con cómo el
estudio organiza el trabajo de verdad. **Esto ya no se arregla solo retipeando plantillas — necesita
un cambio de código real**: la resolución de fecha límite interna de PDT 601/621 tiene que volverse
consciente del dígito de RUC de cada empresa, con el mismo criterio que ya usa `pdt621ScheduleDueDate`
para el cronograma SUNAT (que si acepta un dígito y devuelve la fecha de su grupo).

### 2.3 Retipeo de plantillas — ✅ CONFIRMADO (2026-09-17)

`ActivityTemplate.ActivityType` se edita desde el Catálogo de actividades (`/finance/activity-templates`,
sidebar) — esa parte sigue siendo edición de datos. Pero como se ve en §2.2, no basta con ponerle
`pdt_601` a una sola plantilla: **hay que retipear cada una de las 2 (PDT 601) + 6 (PDT 621) plantillas
por grupo de RUC**, y el código tiene que aprender a leerlas todas juntas, no solo la primera que
encuentre.

**Decisión del usuario**: el mapeo de abajo queda confirmado tal cual. Además:
- Solo `pdt_601`, `pdt_621`, `detracciones` y `sunat_inbox` se controlan por fecha/hora parametrizada
  por ahora — son los únicos módulos con lógica de evaluación de cumplimiento ya construida.
- El resto de plantillas (Balances por RUC, Preliminar de ventas, Gratificaciones, etc.) se quedan en
  `other` **por ahora**, no porque no importen, sino porque todavía no existe la lógica de evaluación
  de cumplimiento para esas actividades. **Nota para el futuro**: cuando se decida construir control de
  cumplimiento para alguna de ellas (ej. "Balances por RUC", "Preliminar de ventas"), el catálogo debe
  permitir asignarle un tipo propio y parametrizable — hoy el enum de `activity_type` es un conjunto
  fijo en el código Go (`backend/services/activity_template_service.go:27-39`, respaldado por
  `backend/models/finance_calendar.go:17-29`): `nps`, `pdt_601`, `pdt_621`, `sire`, `payment`,
  `liquidation`, `report`, `closing`, `detracciones`, `sunat_inbox`, `other` — agregar un tipo nuevo con
  su propia lógica de evaluación es trabajo de código, no solo de catálogo. Esto queda fuera de alcance
  de esta limpieza, pero anotado para cuando corresponda. (Corrección: una versión anterior de este
  documento incluía por error `renta_anual` en esta lista — ese valor no existe en el enum de
  `activity_type`, pertenece a un enum distinto, `SupervisorDeclarationType`
  (`backend/models/supervisor.go:44`), usado para `supervisor_declarations.declaration_type`, no para
  plantillas de calendario. También faltaba `report`, que sí es un valor válido del enum de
  `activity_type`, hoy sin ninguna plantilla usándolo.)

| Plantilla (producción) | Tipo sugerido |
|---|---|
| `DECLARACION DE PLANILLAS RUC 0 AL 4` | `pdt_601` |
| `DECLARACION DE PLANILLAS RUC 5 AL 9` | `pdt_601` |
| `DECLARACION Y ENVIO DE LIQUIDACION DE IMPUESTOS RUC 0` | `pdt_621` |
| `DECLARACION Y ENVIO DE LIQUIDACION DE IMPUESTOS RUC 1` | `pdt_621` |
| `DECLARACION Y ENVIO DE LIQUIDACION DE IMPUESTOS RUC 2 Y 3` | `pdt_621` |
| `DECLARACION Y ENVIO DE LIQUIDACION DE IMPUESTOS RUC 4 Y 5` | `pdt_621` |
| `DECLARACION Y ENVIO DE LIQUIDACION DE IMPUESTOS RUC 6 Y 7` | `pdt_621` |
| `DECLARACION Y ENVIO DE LIQUIDACION DE IMPUESTOS RUC 8 Y 9` | `pdt_621` |
| `DESCARGA E IMPRESIÓN DE ESTADOS DE CTA DETRACCIONES` | `detracciones` |
| `INFORME DETRACCIONES` | `detracciones` |
| `REVISION DE BUZON ELECTRONICO SUNAT Y SUNAFIL` (hay 2 plantillas con este nombre) | `sunat_inbox` |
| Resto (Balances por RUC, Feriado, Preliminar de ventas, Gratificaciones, Informe de deudas,
  Beneficiario final, Planillas con tareo, Envío de NPS y boletas, comunicación con clientes) | `other` (genéricas de verdad, sin relación con ningún módulo) |

### 2.4 Hallazgo adicional confirmado — la regla de cumplimiento (`ActivityRule`) se copia bien al crear, pero se congela y no se re-sincroniza al duplicar un mes

El catálogo sí tiene el mecanismo de parametrización que describió el usuario:
`ActivityRule` (`backend/models/activity_rule.go`) define `compare_mode` (`date` = control por fecha,
`datetime` = control por hora exacta con `max_upload_time`) y `grace_days` (días de gracia extra). Las
33 plantillas de producción sí tienen `activity_rule_id = 1` asignado (la única regla que existe hoy,
"Fecha Simple": por fecha, 0 días de gracia).

**Corrección respecto a una primera lectura**: `CreateActivity` (crear UNA actividad nueva desde una
plantilla) sí copia bien la regla — `applySnapshotsFromTemplate`
(`backend/services/finance_calendar_service.go:186`) hace `a.ActivityRuleID = tpl.ActivityRuleID`. El
problema real está en **"Duplicar mes"** (`DuplicateCalendarOptions`/`DuplicateCalendar`,
`backend/services/finance_calendar_service.go:411-494` — ver §2.5): al copiar un período a otro, copia
el `ActivityRuleID` **que ya tenía la actividad de origen**, no el que tiene la plantilla maestra
*ahora*. Si el primer mes que se creó (probablemente junio, antes de que existiera la regla "Fecha
Simple") quedó con `activity_rule_id = NULL`, y los meses siguientes se armaron duplicando ese primer
mes en vez de crear las actividades de cero, el `NULL` se sigue arrastrando mes a mes aunque las
plantillas maestras ya tengan la regla bien asignada desde hace tiempo. Confirmado: las 171 filas de
`finance_calendar_activities` en los 4 períodos existentes (junio a setiembre 2026) tienen
`activity_rule_id = NULL`. Como `LoadActiveActivityRule(nil)` devuelve `nil`
(`backend/services/activity_rule_service.go:218-221`) y `BuildUploadDeadline` con regla `nil` usa fin
del día sin gracia (`backend/services/upload_timeliness.go:92-99`), hoy no cambia nada en la práctica
(la única regla que existe es igual de trivial), pero es un vacío real si en algún momento se crea una
regla distinta (por hora, o con días de gracia) y se sigue duplicando meses en vez de crear actividades
nuevas desde la plantilla.

### 2.5 Cómo se arma un calendario — corrección: SÍ hay herramientas para no hacerlo 100% a mano

**Esto lo corrijo directamente porque mi primera lectura fue incompleta** — sí existen dos mecanismos
reales, reachable desde la pantalla `/finance/calendar`, que evitan reconstruir cada mes desde cero:

1. **"Duplicar mes"** (`DuplicateMonthModal.tsx`, botón real en `FinanceCalendar.tsx`) → llama a
   `DuplicateCalendar(fromYM, toYM, opts)` en el backend, que puede copiar de un período a otro: las
   actividades completas (`CopyActivities`), los feriados/marcas (`CopyMarks`, vía
   `FinanceCalendarMark` — la tabla que en la Sección de tablas vacías se marcó como "con CRUD pero sin
   usar todavía"; ahora queda más claro: si nunca se marcó un feriado con esta herramienta, nunca hay
   nada que duplicar tampoco) y las notas del calendario (`CopyNotes`).
2. **Arrastrar y soltar (drag & drop)** (`useCalendarDrag.ts`, usado desde `CalendarGrid.tsx`) — mover
   una actividad a otro día, o extender/acortar su rango de fechas, dispara `onCommit` al soltar el
   mouse, que termina llamando a `UpdateActivity` (`finance_calendar_service.go:592`) para persistir el
   nuevo día.

**Lo que sigue siendo cierto**: no hay generación automática que salte domingos o ponga "FERIADO" por
sí sola — ese patrón (visible en los 3 meses analizados) es el resultado de que alguien, la primera vez
que armó un mes, ubicó cada actividad a mano (o con drag & drop) evitando los domingos y marcando los
feriados — y probablemente los meses siguientes salieron de duplicar ese primer mes y reacomodar
fechas con drag & drop, no de repetir la construcción manual completa cada vez. Eso explica también por
qué el `activity_rule_id = NULL` se mantiene idéntico en los 4 períodos (§2.4): quien arma el mes
probablemente usa "Duplicar mes" + drag & drop para ajustar días, no recrea cada actividad desde la
plantilla.

**Esto SÍ cambia el plan de corrección de la Sección 2.6**: no hace falta reconstruir cada uno de los 4
períodos ya creados actividad por actividad — alcanza con corregir bien **un** período (tipos de
plantilla + `activity_rule_id`, actividad por actividad, ese sí a mano) y, para adelante, generar los
períodos nuevos con "Duplicar mes" a partir de ese período ya corregido. Los períodos históricos
(junio-agosto) quedarían como están, a menos que se decida corregirlos también por su valor de
reporte/auditoría retroactiva.

### 2.6 Alcance por período — cuánto hay que corregir

Ya existen 4 períodos con calendario creado en producción (`finance_calendars`): 2026-06 (35
actividades), 2026-07 (49), 2026-08 (43), 2026-09 (44). Cada uno tiene su propia "foto" congelada
(`FinanceCalendarActivity.ActivityTypeSnapshot`) tomada de la plantilla en el momento de crearse —
corregir la plantilla maestra en el catálogo **no corrige retroactivamente** estos períodos ya
creados. Con la corrección de §2.5, el plan realista es: corregir bien un período de referencia
(actividad por actividad, tipo + `activity_rule_id`), y de ahí en adelante generar los períodos nuevos
con "Duplicar mes" desde ese período ya corregido — no hace falta tocar los 4 uno por uno salvo que se
quiera además corregir el histórico junio-setiembre por temas de reporte.

### 2.7 Decisiones

1. ✅ **DECIDIDO (2026-09-17)**: mapeo de plantillas confirmado tal cual §2.3.
2. ✅ **DECIDIDO (2026-09-17)**: el cálculo de "Entregado a tiempo/fuera de fecha" debe comparar la
   entrega de cada empresa contra el grupo de RUC que le corresponde — mismo criterio que el
   cronograma SUNAT. Aplica a `pdt_601`, `pdt_621`, `detracciones` y `sunat_inbox` (los 4 tipos con
   lógica de evaluación real, según §2.3).
3. ✅ **DECIDIDO (2026-09-17)**: orden de trabajo entre esta sección y la Sección 1 —
   1. Terminar de implementar la Sección 1 (eliminar NPS) completa, backend y frontend.
   2. **Antes de empezar esta Sección 2**: volver a revisar `SupervisorControlDetail.tsx` completa —
      las otras pestañas (Declaraciones, Liquidación, Historial) también tenían referencias a NPS que
      hay que confirmar que quedaron limpias, no solo la pestaña NPS misma.
   3. Recién ahí empezar la Sección 2. Dentro de esta sección: corregir el período actual (setiembre)
      actividad por actividad, y usar "Duplicar mes" desde ahí hacia adelante (no hace falta corregir
      junio-agosto retroactivamente).
4. **Pendiente de decidir — en análisis conjunto**: sobre `ActivityRule`/`DuplicateCalendar` (§2.4).
   Contexto para decidir: `DuplicateCalendar` no solo copia `ActivityRuleID` congelado — copia
   **todos** los campos "snapshot" (nombre, tipo, prioridad, color, ícono, regla) tal como están en el
   mes de origen, nunca vuelve a leer la plantilla maestra. Es un comportamiento consistente en los 6
   campos, no un caso especial solo del `activity_rule_id`. Si arreglamos setiembre correctamente (tipo
   + regla) y duplicamos desde ahí hacia adelante, cada mes nuevo hereda lo correcto automáticamente —
   **el plan de la pregunta 3 ya resuelve el problema práctico sin tocar código de `DuplicateCalendar`**.
   La única situación que seguiría sin cubrirse: si más adelante se edita la plantilla maestra (ej. se
   cambia la regla a "por hora"), esa mejora NO se propaga sola a los meses ya creados ni a sus futuras
   duplicaciones — habría que corregir manualmente el mes de referencia una vez más y seguir
   duplicando desde ahí. **Recomendación**: no tocar `DuplicateCalendar` (mantenerlo como clonado
   consistente de los 6 campos), y en su lugar mantener la disciplina de corregir el mes de referencia
   cada vez que cambie una plantilla maestra, antes de seguir duplicando.

   ✅ **DECIDIDO (2026-09-17)**: se toma la recomendación — no se toca `DuplicateCalendar`.

   **Aclaración importante sobre qué implica esto en la práctica** (confirmado en el código): la regla
   sí "persiste" al duplicar, pero como copia literal, no como recálculo — `activity_rule_id` se clona
   exactamente igual que el tipo. Consecuencia directa para el checklist: al corregir el período de
   referencia (setiembre) hay que asignarle el `activity_rule_id` correcto a cada actividad, **no solo
   el tipo** — si se corrige el tipo pero se deja la regla en `NULL`, "Duplicar mes" seguirá propagando
   el `NULL` para siempre igual que hoy.

   **Caveat adicional, mismo mecanismo**: `DuplicateCalendar` también copia el número de día
   (`start_day`/`end_day`/`due_day`) tal cual, sin ajustarlo al mes nuevo — si "RUC 8 Y 9" vence el
   día 15 en setiembre, en octubre también quedará el día 15 sin revisar si cae domingo o feriado. Cada
   mes duplicado sigue necesitando una revisión manual con drag & drop para esos casos — "Duplicar mes"
   ahorra volver a tipear/tipear todo, pero no reemplaza la revisión de fechas mes a mes.

### 2.7b Hallazgo de diseño adicional (implementación, 2026-09-17) — falta un dato estructurado para el grupo de RUC

Al empezar a implementar §2.7 punto 2, apareció un vacío que el documento no había cerrado: **ni
`ActivityTemplate` ni `FinanceCalendarActivity` tienen ningún campo que diga qué dígitos de RUC cubre
una actividad** — la agrupación ("RUC 0 AL 4", "RUC 5 AL 9") solo existe como texto libre en el
nombre. Sin un dato estructurado, el código no tiene forma de cruzar el dígito de una empresa contra
la actividad que le corresponde (a diferencia del cronograma SUNAT, que sí tiene
`sunat_due_date_calendar_rows.dates_json`, un arreglo indexado por dígito).

✅ **DECIDIDO (2026-09-17)**: se agregan dos campos nuevos, **`RucDigitStart`/`RucDigitEnd`**
(`*int`, opcionales — `nil` significa "aplica a todas las empresas, sin distinción de dígito") a
`ActivityTemplate` (el dato real, editable desde el catálogo) y su copia congelada
`RucDigitStartSnapshot`/`RucDigitEndSnapshot` en `FinanceCalendarActivity` (mismo patrón que los
demás campos "snapshot"). Se descartaron las otras dos opciones planteadas: adivinar el rango
parseando el nombre (frágil, ya hay variantes de formato) y dejar una sola fecha sin distinguir RUC
(contradice la decisión de §2.7 punto 2).

### 2.8 Checklist — **código implementado 2026-09-17, falta el trabajo de datos**

- [x] Backend: agregar `RucDigitStart`/`RucDigitEnd` a `ActivityTemplate` y su snapshot en
      `FinanceCalendarActivity` (§2.7b) + reflejarlo en `applySnapshotsFromTemplate` y `DuplicateCalendar`
      — columnas nuevas, se agregan solas al reiniciar el backend (AutoMigrate)
- [x] Backend: `FindCalendarActivityByTypeAndDigit`/`PickCalendarActivityByDigit`
      (`calendar_activity_timeliness.go`) — resuelve la actividad correcta por tipo+período+dígito,
      con comodín para plantillas sin rango; `FindCalendarActivityByType` (sin dígito) queda intacta
      para Detracciones/Buzón SOL, que hoy no agrupan por RUC
- [x] Backend: `pdt601PeriodDueDate`/`pdt621PeriodDueDate`, `findPdt601/621CalendarActivity` ahora
      piden el dígito de la empresa; el filtro SQL del listado (`entregado_a_tiempo`/
      `entregado_fuera_de_fecha`) y el desglose del dashboard usan un `CASE` SQL
      (`pdt601/621DueDateSQLCase`) correlacionado al dígito de cada empresa en vez de una fecha única
- [x] Backend: corregido `companyCompliance`/`ActivityCompliance` para que el panel "Cumplimiento" del
      calendario resuelva la fecha límite por el grupo de RUC de cada empresa en `pdt_601`/`pdt_621`
      (§2.9). De paso se encontró y corrigió un bug aparte: `declarationComplete` solo reconocía los
      valores viejos (`aprobado`/`presentado`/`cerrado`), nunca `entregado` — el panel nunca iba a
      marcar "completada" ninguna declaración PDT601/621 ya aprobada bajo el rediseño nuevo
- [x] Frontend: campos "Dígito desde"/"Dígito hasta" en `ActivityTemplateForm.tsx`, con validación
      (0-9, van juntos o ninguno, desde ≤ hasta) — de paso se corrigió el valor por defecto del select
      de tipo al crear una plantilla nueva, que seguía siendo `'nps'` (ya no es un tipo válido)
- [x] Verificar: `go build`/`go test` (services/database/controllers) y `tsc`/`npm run build` — todo
      limpio. Los tests atraparon un bug real de SQL malformado (`CASE ELSE x END` sin ningún `WHEN`
      cuando solo hay una plantilla comodín sin rango) antes de llegar a producción.
- [x] **Retipear las 2 + 6 plantillas maestras en el catálogo, con su rango de dígitos** (2026-09-17,
      hecho por el navegador en local dev, usuario `admin1`) — `AC7`/`AC16` → `pdt_601` (0-4 / 5-9),
      `AC19`-`AC24` → `pdt_621` (0-0 / 1-1 / 2-3 / 4-5 / 6-7 / 8-9). De paso se les asignó
      `activity_rule_id = 1` ("Fecha Simple") por SQL directo — el formulario del catálogo no expone
      ese campo (no está en el alcance de §2.7b) y en dev local las 8 plantillas lo tenían en `NULL` a
      diferencia de producción (§2.4, donde las 33 plantillas ya lo tienen seteado)
- [x] Corregir setiembre (período de referencia) actividad por actividad — **tipo Y `activity_rule_id`
      de cada una**, no solo el tipo (2026-09-17) — `UpdateActivity` (usada por edición/drag&drop) no
      re-sincroniza los campos "snapshot" desde la plantilla (§2.4/§2.6), así que se eliminaron las 8
      actividades mal tipadas (`nps`, `activity_rule_id NULL`) del calendario de setiembre y se
      recrearon desde las plantillas ya corregidas (mismo día de vencimiento en cada caso: 4, 5, 8, 9,
      10, 11, 12, 15) — confirmado en BD que las 8 nuevas llevan el tipo, el rango de dígitos y
      `activity_rule_id = 1` correctos
- [ ] Usar "Duplicar mes" desde setiembre para los períodos siguientes (dato, pendiente)
- [ ] Si corresponde: corregir también junio-agosto para reportes históricos (dato, pendiente)
- [x] ~~Hacer que `DuplicateCalendar` re-sincronice `activity_rule_id`~~ — descartado, no se toca ese
      código (decisión 2026-09-17)
- [x] Probar en navegador: el panel "Cumplimiento" de una de las 8 actividades corregidas
      (`GET /finance/calendar/activities/:id/compliance`) carga sin error y evalúa las empresas del
      estudio — verificado en dev local (2026-09-17). **Limitación de la prueba**: todos los días de
      vencimiento de setiembre (4, 5, 8-15) ya pasaron respecto a hoy (17 de setiembre), así que toda
      empresa aparece "vencida" sin importar contra qué fecha límite se la compare — la prueba visual
      no puede distinguir el comportamiento corregido (por grupo de RUC) del bug viejo (fecha única).
      La corrección en sí ya está cubierta por los tests unitarios de backend (§2.8, ítem de
      `go test`), que sí fuerzan casos con fechas futuras/pasadas distintas por grupo.

### 2.8b Hallazgo durante el retipeo (2026-09-17) — 2 plantillas de prueba preexistentes, sin relación con el mapeo de producción

Al revisar el catálogo de dev local antes de retipear, aparecieron dos plantillas que **no están en el
mapeo de §2.3**: `AC37 – "PDT 601 – Planilla electrónica"` y `AC38 – "Control Vencimientos PDT 621"`
(creadas 2026-08-21, antes de esta sesión), ya tipadas como `pdt_601`/`pdt_621` pero **sin rango de
RUC** (comodín — aplican a todas las empresas). El calendario de setiembre tenía una actividad de cada
una (creadas 2026-09-16, IDs 164/165, día 14) — probablemente artefactos de QA de una sesión anterior
(verificación del rediseño de estados PDT601/621), no datos reales del estudio.

**Decisión del usuario (2026-09-17): eliminarlas.** Ejecutado:
1. Se eliminaron (borrado lógico, vía UI) las 4 actividades de calendario que las usaban —
   `AC037`/`AC038` tenían una instancia cada una en agosto (día 14) y en setiembre (día 14).
2. Al intentar `Eliminar` las plantillas `AC037`/`AC038` desde el catálogo, el backend lo rechazó:
   *"no se puede eliminar: la plantilla tiene actividades en calendarios; desactívela con
   active=false"* — `ActivityTemplateService.CountCalendarReferences` usa `.Unscoped()` a propósito,
   así que cuenta también las actividades borradas lógicamente (para no dejar huérfana la referencia
   `activity_template_id` de filas de auditoría/histórico ya eliminadas). Este guardarropa es
   intencional, no un bug — no se intentó saltarlo por SQL directo.
3. Se usó la alternativa que el propio mensaje de error sugiere: **desactivar** (`active=false`) ambas
   plantillas desde el catálogo. Confirmado en BD: `AC037`/`AC038` con `active=0`. Quedan fuera del
   catálogo activo (no aparecen para crear nuevas actividades) pero conservan su historial de
   calendario intacto.

El calendario de setiembre y agosto vuelve a mostrar solo las actividades reales (2 PDT601 + 6 PDT621
en setiembre, en sus días correctos), sin las 2 entradas de prueba adicionales del día 14.

### 2.9 HALLAZGO NUEVO (verificación cruzada, 2026-09-17) — el panel "Cumplimiento" del calendario tiene el mismo problema, en una función distinta

Al mandar a verificar este documento contra el código antes de implementar, apareció un problema que
no estaba cubierto: `companyCompliance` (`backend/services/finance_calendar_service.go:644-729` — la
misma función cuyo `switch` se toca en la Sección 1 para quitar los casos NPS/Payment) tiene, en su
propio `case models.CalendarActivityPDT601, models.CalendarActivityPDT621, models.CalendarActivitySIRE:`
(líneas 667-677), **el mismo defecto de "una sola fecha límite" que el resto de la Sección 2** —
pero en un consumidor distinto: no es `pdt601PeriodDueDate` (que resuelve "Entregado a tiempo/fuera de
fecha" en la declaración de cada empresa), sino `ActivityCompliance`
(`finance_calendar_service.go:744-814`, la función que arma el panel "Cumplimiento" al que se llega
desde el Calendario financiero, `GET /finance/calendar/activities/:activityId/compliance`).

**Por qué hoy no se nota**: con cero plantillas tipadas `pdt_601`/`pdt_621` en producción (§1.3), este
panel nunca se abre para ninguna de esas dos actividades — el problema está latente. **En el momento
en que se ejecute el retipeo de §2.3** (2 plantillas `pdt_601` + 6 `pdt_621`), abrir el panel
"Cumplimiento" de, por ejemplo, "LIQUIDACION DE IMPUESTOS RUC 0" va a evaluar **las 328 empresas** del
estudio contra la fecha límite de esa única actividad — incluyendo empresas de otros grupos de RUC que
en realidad tienen otra fecha límite — mostrando "vencida" o "completada" incorrectamente para gran
parte de esas 328 empresas.

✅ **DECIDIDO (2026-09-17)**: se corrige junto con el resto de la Sección 2, no se deja para después —
`companyCompliance`/`ActivityCompliance` también debe volverse consciente del grupo de RUC de cada
empresa para `pdt_601`/`pdt_621`, con el mismo criterio de §2.7 punto 2.

## 3. Pestaña "Declaraciones" — pasarla a solo lectura

Confirmado en código y con datos reales de producción: esta pestaña deja editar, **para cualquier
tipo de declaración del control** (`pdt_601`, `pdt_621`, `sire`, `renta_anual`, `sunat_inbox`,
`detracciones`), campo por campo, vía el mismo `PUT /supervisors/declarations/:id` genérico
(`patchDeclaration` en `SupervisorControlDetail.tsx`, líneas ~412-590 del bloque de la pestaña):
estado (select de 7 valores viejo), % de avance, prioridad, fecha de vencimiento, responsable y
aprobador — además de un botón de "Subir" adjunto y los botones "Aprobar"/"Observar".

**Importante — confirmado también**: producción todavía corre el código **anterior** al rediseño de
estados (nunca se hizo push de `c4b7f02`/`403b443`) — las declaraciones PDT 601/621 en producción
siguen con el enum viejo de 7 valores (`aprobado`/`presentado`/`en_revision`/`cerrado`). Varios
hallazgos de acá describen lo que pasará **una vez desplegado** el rediseño, no necesariamente el
comportamiento de hoy mismo.

### 3.1 Campo por campo — qué hace cada uno hoy, y qué tan real es su uso

| Campo | Backend | Uso real en producción |
|---|---|---|
| **Estado** (select 7 valores) | Bloqueado por `validatePdt601Pdt621StatusTransition`/`validateDetraccionesStatusTransition` para `pdt_601`/`pdt_621`/`detracciones` (una vez desplegado). **Sin ningún guardarropa para `sunat_inbox`** — cambiarlo acá lo sacaría del flujo real sin que nadie se entere. | El riesgo de `sunat_inbox` es hoy teórico: **0 declaraciones de tipo `sunat_inbox` existen en `supervisor_declarations` en producción** — nadie ha llegado a generarlas todavía. |
| **% de avance** | `UpdateDeclaration` lo guarda **sin ningún guardarropa, para cualquier tipo**, incluidos `pdt_601`/`pdt_621` (`backend/services/supervisor_service.go`, bloque `if in.ProgressPct != nil`). | 175 ediciones reales registradas en `supervisor_change_logs` (campo `progress_pct`) — se usa de verdad, sin protección. |
| **Vencimiento** (`due_date`) | Se guarda sin guardarropa (`if in.DueDate != nil`). `resolvePdt601DueDate`/equivalente PDT621 le da **prioridad sobre la fecha calculada del calendario** — si alguien lo llena acá, sobreescribe en silencio el cálculo por grupo de RUC de la Sección 2. | **0 de ~8500 declaraciones en producción lo tienen seteado, nunca** — riesgo real pero no explotado todavía. |
| **Responsable** (`responsible_user_id`) | Se guarda sin guardarropa. No se lee/filtra en ningún otro lugar del backend (confirmado: solo existe el campo homónimo de `SupervisorMonthlyControl`, uno distinto, que sí se usa para reportes/productividad — no hay que confundirlos). No se muestra en `Pdt601DetailPage.tsx` ni en ninguna página dedicada. | **0 de todas las declaraciones, de cualquier tipo, en producción** — 100% sin uso real. |
| **Aprobador** (`approver_user_id`) | Se llena **automáticamente** al usar "Aprobar" (`ApproveDeclaration`), sin importar si se dispara desde acá o desde la página dedicada. El selector manual de esta pestaña es una vía adicional para pisarlo a mano. | 166 declaraciones PDT 601 y 7 PDT 621 lo tienen seteado — dato real, pero es el auto-seteo de "Aprobar", no evidencia de que alguien use el selector manual. |
| **Adjuntos** | Misma tabla (`supervisor_attachments`) que usan las páginas dedicadas de PDT 601/621 para subir archivos — mismo dato, dos puntos de entrada de UI. | N/A — es la misma data, solo duplica la forma de llegar a ella. |
| **Acciones (Aprobar/Observar)** | Confirmado seguro: `ApproveDeclaration`/`ObserveDeclaration` despachan a las mismas funciones protegidas (`approvePdt601Pdt621Declaration`, `observePdt601Pdt621Declaration`, `observeDetraccionesDeclaration`) sin importar desde dónde se llamen — no hay forma de saltarse las reglas desde acá. | Real, pero duplica los mismos botones que ya existen en las páginas dedicadas. |

**Hallazgo adicional, sin buscarlo**: editar prioridad, vencimiento, responsable o aprobador desde
esta pestaña **no deja ningún rastro en Historial** — `LogChange` (`backend/services/supervisor_service.go`,
función `UpdateDeclaration`) solo registra cambios de `status` y `progress_pct`. El resto se guarda en
silencio, sin auditoría.

### 3.2 Hallazgo nuevo — SIRE y Renta Anual (los dos tipos sin página propia) tampoco se usan de verdad

`sire` y `renta_anual` son los únicos dos tipos de declaración sin página dedicada — esta pestaña
genérica es, en teoría, su única forma de gestión. Se verificó su uso real en producción:

```
sire         pendiente   1379   (100%, nunca se movió de ahí)
renta_anual  pendiente   1379   (100%, nunca se movió de ahí)
```

**Ninguna de las 1379 declaraciones de cada tipo salió nunca de "Pendiente"** — ni un solo Aprobar, ni
un solo Observar, en la historia de la base. Mismo patrón que NPS: una funcionalidad con una vía de
gestión real, pero cero evidencia de que alguien la use. `detracciones` también es marginal (2 filas
en total, gestionadas por su propia página dedicada, no por esta pestaña).

### 3.3 Pestaña "Liquidación" — CORRECCIÓN a una suposición del usuario, confirmado que no hay duplicado

Se verificó en código: `updateLiquidation`/`approveLiquidation`/`observeLiquidation`/`getLiquidation`
(los que alimentan esta pestaña, tabla `supervisor_tax_liquidations`) **solo se llaman desde
`SupervisorControlDetail.tsx`** — no existe ninguna otra vista del frontend que cree o edite esta
tabla (aparte del bootstrap automático al crear el control). No es la misma tabla ni el mismo
concepto que la página "Liquidaciones" del sidebar (`tax_settlements`) — eso ya se había confirmado
en la Sección 0. **Esta pestaña sigue siendo el único lugar real para este dato, y alimenta Reportes y
el Calendario financiero (§ investigación previa) — no se toca.**

### 3.4 Pestaña "Historial" — de dónde sale, confirmado real con un hueco menor

Se rastrearon todas las llamadas a `LogChange` en el backend: sí captura acciones reales —
Detracciones (`supervisor_detracciones_service.go`), las acciones dedicadas de PDT 601/621 (Aprobar/
Observar/Reabrir, en `supervisor_service.go`), Buzón SOL (`supervisor_sunat_inbox_service.go`), y la
ruta genérica (`UpdateDeclaration`, usada también por Aprobar/Observar de SIRE/Renta Anual). No es un
dato huérfano ni desconectado de la actividad real.

**Hueco real, menor**: la acción "Entregar" (cuando el asistente guarda con fecha de entrega y el
sistema transiciona automáticamente a `por_revisar`, en `SavePdt601Planilla`/`SavePdt621Record`) **no
llama a `LogChange`** — Historial ve Aprobar/Observar/Reabrir, pero no ve la entrega inicial. No se
propone corregir esto ahora (fuera de alcance de esta limpieza), queda anotado.

**No se propone ningún cambio a esta pestaña** — es real y no está duplicada.

### 3.5 Propuesta — pasar "Declaraciones" a solo lectura

Con base en 3.1-3.2, la dirección que se conversó:

- **Quitar edición de estado** por completo (ya sea select o acción) — para todos los tipos, sin
  excepción. Mostrar solo la etiqueta del estado real (`declarationStatusLabel`).
- **Quitar edición de % de avance, prioridad, vencimiento y responsable** — mostrar como texto, no
  como campo editable. La columna "Responsable" puede eliminarse directamente (0% de uso real, no
  aporta nada).
- **Adjuntos**: solo listar/descargar, quitar el botón "Subir" (ya existe en las páginas dedicadas
  para los tipos que las tienen).
- **Acciones (Aprobar/Observar)**: quitar de esta pestaña — ya existen en las páginas dedicadas de
  PDT 601/621/Detracciones.

✅ **DECIDIDO (2026-09-17)**: opción 1 — SIRE y Renta Anual también quedan en solo lectura, sin
Aprobar/Observar acá. Mismo criterio que NPS: 0% de uso real en 1379+1379 filas no justifica mantener
una vía de edición "por si acaso". Si en el futuro se decide gestionar estos dos tipos de verdad,
será con una página dedicada propia (fuera de alcance de esta limpieza).

### 3.6 Checklist — **implementado 2026-09-17**

- [x] Decidir qué hacer con SIRE/Renta Anual — **opción 1, solo lectura para todos los tipos**
- [x] Frontend: quitar el select de estado y la función `patchDeclaration`
- [x] Frontend: quitar edición de % de avance, prioridad, vencimiento — ahora texto plano; columna
      **Responsable eliminada por completo** (0% de uso real, no se muestra en ningún lado)
- [x] Frontend: quitar el botón "Subir" adjunto de esta pestaña — solo lista/descarga, con mensaje
      "Sin adjuntos" cuando corresponde
- [x] Frontend: quitar los botones Aprobar/Observar de esta pestaña (siguen intactos en las páginas
      dedicadas de PDT 601/621/Detracciones, verificado que `approveDeclaration`/`observeDeclaration`
      se siguen llamando desde ahí)
- [x] Verificar: `tsc`/`npm run build` — limpio
- [ ] Probar en navegador: pendiente de una pasada visual (no crítico, el build y el tipo ya lo
      garantizan estructuralmente)

## 4. Próximas secciones (pendiente — indicar cuál sigue)

- `company_assignments` (huérfana — se lee pero no hay forma de escribir).
- `activity_params`/`activity_param_audits` (huérfana — sin controlador ni UI).

## 5. Dashboard de supervisores — auditoría de filtros y métricas (2026-09-17)

Verificación pedida por el usuario una vez implementadas las Secciones 1-3: revisar si los filtros,
las tarjetas, los dos gráficos (distribución por estado, tendencia 6 meses) y la productividad por
supervisor del dashboard (`/supervisors/dashboard`) muestran datos reales y consistentes. Metodología:
lectura de `SupervisorDashboard.tsx` + `supervisor_service.go`, cruzada con consultas SQL directas a
la BD local (`supervisor_monthly_controls`, `companies`, `supervisor_change_logs`) y prueba en vivo en
el navegador (usuario `admin1`, período agosto/setiembre 2026).

**Conclusión general**: no se encontró ningún bug de cálculo ni de wiring — cada tarjeta, filtro y
gráfico corresponde exactamente a la consulta SQL que dice calcular (verificado número por número
contra la BD). Lo que se encontró son **funcionalidades manuales que nunca se usaron**, con el mismo
patrón que ya se documentó en la Sección 3 para los campos de la pestaña Declaraciones — y un hueco
real de alcance en la Sección 2 (el bucket "Vencido" de PDT 601/621 no quedó cableado a la fecha
límite por grupo de RUC).

### 5.1 Filtro "Riesgo" — código correcto, dato sin usar (0% en 1530 controles)

`risk_level` (`SupervisorMonthlyControl.RiskLevel`, editable a mano desde "Nivel de riesgo" en el
detalle del control) está en `'bajo'` en el **100% de los controles, en los 6 períodos existentes**
(abril a setiembre 2026, 1530 filas). Confirmado además que `supervisor_change_logs` no tiene ninguna
fila con `field_name = 'risk_level'` — nunca se cambió a mano ni una vez. Probado en el navegador:
filtrar por "Medio" devuelve el dashboard entero en cero (incluida "Empresas activas"). El filtro
funciona bien, pero es inútil en la práctica porque no hay variación en el dato que filtra.

### 5.2 Filtro "Responsable" — el desplegable no distingue quién es realmente "responsable" de algo

El combo "Responsable" (`responsibleUserId`) lista **todos los usuarios del sistema** vía
`usersService.list()`, sin acotar a quiénes tienen empresas asignadas. En la práctica, de 255 empresas
activas, **255 tienen el mismo `accountant_user_id` = 7** (EDWIN ZAPANA CHOQUEMAQUE) y solo 2 quedan en
`NULL` — ningún otro usuario del combo (incluidos los 4 supervisores reales) tiene una sola empresa
asignada como responsable. Probado en el navegador: filtrar por cualquier usuario distinto de Edwin
devuelve el dashboard en cero. El campo que alimenta esto (`companies.accountant_user_id`) nunca se
individualizó por empresa — es un dato de `companies`, no de este dashboard ni de esta sesión.

### 5.3 Filtro "Supervisor" — funciona bien, dato real y distribuido

`supervisor_user_id` sí está poblado con variación real entre 4 usuarios (6/82/84/83 empresas cada
uno) — consistente con lo que muestra "Productividad por supervisor" más abajo. Sin hallazgos.

### 5.4 Tarjetas y resumen PDT 601/621 — coinciden con la BD; confirma que el fix de la Sección 2 ya funciona con datos reales

Todos los números de las tarjetas ("Empresas activas/al día/pendientes/vencidas", "Sin control en
período", "Declaraciones observadas") coinciden exactamente con consultas SQL directas. El resumen PDT
601/621 del período agosto 2026 ya muestra **"Entregado a tiempo: 3" (PDT 601) y "1" (PDT 621)** —
declaraciones reales con `status = 'entregado'` de pruebas anteriores, clasificadas correctamente. Es
la primera confirmación con datos reales (no solo tests unitarios) de que el cálculo de puntualidad de
la Sección 2 está funcionando end-to-end.

### 5.5 "Cumplimiento %" y "Tendencia de cumplimiento (6 meses)" — 0% siempre, en los 6 períodos, por la misma causa raíz que §5.1

`monthly_compliance_pct` = `(controles al_dia + cerrado) / total` — y `general_status` **nunca llegó a
`al_dia` ni a `cerrado` en ningún control, de ningún período** (los 1530 controles de abril-setiembre
están repartidos solo entre `pendiente`/`vencido`/`observado`). `al_dia` se marca a mano (botón
"info recibida" en `RegisterInfoReceived`, o el selector de estado en el detalle del control) y no se
usa. Consecuencia directa: la tarjeta "Cumplimiento %", el gráfico "Tendencia (6 meses)" (que usa la
misma fórmula período a período) y "Productividad por supervisor" (mismo cálculo, agrupado por
supervisor) **muestran 0% siempre**, no por un bug de cálculo sino porque el numerador nunca tiene
nada que sumar. Gráficos y card están bien calculados — la funcionalidad que los alimenta (marcar un
control "al día") está muerta.

### 5.6 Hallazgo adicional — el auto-"vencido" solo corre para el mes en curso

`StartSupervisorAutomationLoop` (backend, corre cada 6h) llama `RunMonthlyAutomations` **solo para
`time.Now()`'s período** (`ym := time.Now().Format("2006-01")`) — nunca para períodos anteriores. La
única otra vía que transiciona `pendiente`/`al_dia` → `vencido` es `SyncOverdueControls`, que se
dispara de forma perezosa dentro de `Dashboard()` **solo para el período que se está consultando en
ese momento**. Resultado observado en BD: julio 2026 quedó 100% `vencido` (alguien abrió esa vista en
algún momento, después de que su `due_date` ya había pasado), pero **abril, mayo y junio siguen 100%
`pendiente`** pese a que sus fechas de vencimiento pasaron hace meses — simplemente nadie volvió a
abrir esos períodos desde entonces. No es un bug introducido esta sesión (afecta períodos anteriores a
cualquier cambio de esta limpieza), pero es un hueco operativo real: períodos viejos y abandonados
pueden quedar subestimados como "pendiente" indefinidamente.

### 5.7 Hallazgo de alcance — el bucket "Vencido" de PDT 601/621 no usa la fecha límite por grupo de RUC de la Sección 2

El bucket `vencido` de `pdtBucketsSelectSQL` (usado por el resumen del dashboard y el filtro del
listado PDT 601/621) compara `COALESCE(d.due_date, c.due_date) < hoy` — es decir, la fecha propia de
la declaración (`d.due_date`, confirmado 0% de uso real en la Sección 3, §3.1) o, si no existe, la
fecha límite **genérica del control** (`c.due_date`, ~día 20 del mes siguiente). **No usa**
`pdt601DueDateSQLCase`/`pdt621DueDateSQLCase` (la fecha límite por grupo de RUC que sí implementamos en
la Sección 2) — esa función solo se usa para clasificar `entregado_a_tiempo`/`entregado_fuera_de_fecha`
(declaraciones ya entregadas), no para decidir si una declaración **todavía pendiente** ya está
vencida.

**Consecuencia práctica**: una declaración PDT 601 cuyo grupo de RUC vence el 4 de setiembre y sigue
sin entregarse **no se marca "Vencida" hasta el 20 de octubre** (fecha genérica del control del período
siguiente), no el 4 de setiembre. Esto es consistente con el alcance que se decidió explícitamente en
§2.7 punto 2 ("el cálculo de 'Entregado a tiempo/fuera de fecha' debe comparar...") — el "Vencido" de
declaraciones pendientes quedó fuera de esa decisión, no fue un olvido de implementación, pero sigue
siendo una inconsistencia real de cara al usuario: el mismo panel muestra puntualidad calculada por
grupo de RUC para lo ya entregado, y una fecha límite completamente distinta (genérica, un mes
después) para decidir si lo no entregado ya está vencido.

### 5.7b Investigación de alcance real (2026-09-17) — dónde vive cada pieza de "Vencido" hoy

Antes de tocar código, se rastreó cada lugar donde "Vencido"/fecha de vencimiento se calcula o se
muestra para PDT 601/621, backend y frontend:

| Lugar | Fuente de fecha hoy | ¿Usa el calendario por grupo de RUC? |
|---|---|---|
| Dashboard — bucket `vencido`/`pendiente` (`pdtBucketsSelectSQL`) | `COALESCE(d.due_date, c.due_date)` | No |
| Listado PDT601/621 — fondo de fila (`pdt601RowBgClass`/`pdt621RowBgClass`) | `row.timeliness`/`row.declaration_timeliness` | **Sí, ya** |
| Listado PDT601/621 — Excel export | `row.timeliness` | **Sí, ya** |
| Detalle de una empresa (`Pdt601DetailPage.tsx`/`Pdt621DetailPage.tsx`) — campo "Vencimiento" | `resolvePdt601DueDate(declaration.due_date, control_due_date)` (cliente) | No |
| `Pdt601ListRow.DueDate/IsOverdue/DaysRemaining` (`Pdt621ListRow` ídem) | `COALESCE(d.due_date, c.due_date)` (servidor) | No — **y no se usa en ningún lado del frontend** (confirmado: ni el listado ni el Excel los leen; son cálculo muerto desde que el listado migró a `timeliness`) |

Hallazgo clave que simplifica la corrección: `ComputeCalendarActivityTimeliness` (usada para
`Timeliness`/`AssistantTimeliness`) **ya devuelve "missing"** cuando la declaración sigue sin
entregarse y la fecha límite del calendario ya pasó — es decir, el concepto "Vencido por grupo de RUC"
ya existe y ya se calcula correctamente, solo que (a) el bucket agregado del dashboard no lo usa, y
(b) las páginas de detalle no lo consumen porque el backend nunca expuso la **fecha** resuelta del
calendario (`UploadTimelinessDTO.DueAt`), solo la etiqueta de puntualidad — así que el frontend
recalculaba la fecha por su cuenta, con la fuente vieja.

✅ **DECIDIDO (2026-09-17)** — plan de corrección, 3 partes:

1. **`pdtBucketsSelectSQL`** (backend, `supervisor_service.go`): el bucket `vencido`/`pendiente` pasa a
   comparar contra `pdt601DueDateSQLCase`/`pdt621DueDateSQLCase` (igual patrón que
   `entregado_a_tiempo`/`fuera_de_fecha`) en vez de `COALESCE(d.due_date, c.due_date)`. Si el período no
   tiene ninguna actividad `pdt_601`/`pdt_621` configurada (`ok=false`), se mantiene el fallback viejo
   (`COALESCE(d.due_date, c.due_date)`) para no perder cobertura en períodos sin calendario armado. Si
   el período SÍ tiene actividades pero el dígito de una empresa puntual no cae en ningún rango (caso
   raro, sin comodín), esa fila no cuenta como vencida — mismo criterio "no castigar por falta de
   configuración" que ya usan `pdt601OnTime`/`pdt601Late`.
2. **Exponer la fecha límite resuelta**: agregar `CalendarDueDate *time.Time`
   (`json:"calendar_due_date,omitempty"`) a `Pdt601Detail`/`Pdt621Detail`, tomado de
   `ComputeCalendarActivityTimeliness(...).DueAt` (hoy se descarta, solo se guarda `.Timeliness`).
3. **Frontend — páginas de detalle**: `Pdt601DetailPage.tsx`/`Pdt621DetailPage.tsx` dejan de llamar
   `resolvePdt601DueDate(declaration.due_date, control_due_date)` y en su lugar usan
   `resolvePdt601DueDate(detail.calendar_due_date, detail.control_due_date)` — mismo helper de
   formateo (`computePdt601DueMeta`/`formatPdt601DueDetail`), solo cambia la fuente de la fecha. Se deja
   de leer `declaration.due_date` (0% de uso real, §3.1) como fuente prioritaria.

**No incluido en este cambio** (anotado para después, no bloquea esto): `Pdt601ListRow.DueDate/
IsOverdue/DaysRemaining` (`Pdt621ListRow` ídem) y sus funciones `pdt601ResolveDueDate`/`pdt601DueMeta`
quedan confirmados como cálculo muerto — el listado y el Excel ya usan `timeliness` desde antes de esta
sesión. Se documenta acá para una limpieza futura (mismo criterio que NPS/campos de Declaraciones), no
se borra en este cambio para no mezclar el fix de "Vencido" con una limpieza de código no relacionada.

### 5.7c Implementado y verificado (2026-09-17)

- [x] Backend: `pdtBucketsSelectSQL` (`supervisor_service.go`) — `vencido`/`pendiente` ahora usan
      `pdt601DueDateSQLCase`/`pdt621DueDateSQLCase` con fallback a `COALESCE(d.due_date, c.due_date)`
      cuando el período no tiene calendario configurado.
- [x] Backend: `Pdt601Detail.CalendarDueDate`/`Pdt621Detail.CalendarDueDate` — nuevo campo
      `calendar_due_date`, poblado desde `ComputeCalendarActivityTimeliness(...).DueAt` en
      `EnsurePdt601`/`SavePdt601Planilla` y en `EnsurePdt621` (vía `pdt621AssistantTimelinessDTO`,
      antes `pdt621AssistantTimeliness` — se cambió para devolver el DTO completo, no solo el label).
- [x] Frontend: `Pdt601DetailPage.tsx`/`Pdt621DetailPage.tsx` — "Vencimiento" ahora usa
      `detail.calendar_due_date` en vez de `declaration.due_date` como fuente prioritaria.
- [x] Tests nuevos: `TestPdtDashboardSummary_VencidoUsaCalendarioNoFechaGenericaDelControl` y su
      equivalente PDT 621 (`supervisor_dashboard_puntualidad_test.go`) — prueban explícitamente que
      una declaración sin entregar cuenta como "Vencido" cuando pasó la fecha del calendario aunque la
      fecha genérica del control todavía no llegue (antes del fix, estos casos hubieran quedado en
      "Pendiente"). `go build`/`go test ./services/...` limpio.
- [x] Verificado en navegador (dev local, backend reiniciado para tomar el código nuevo — `go run .`
      no recarga en caliente):
      - Detalle de una empresa PDT 601 (RUC dígito 0, setiembre) ahora muestra "Vencimiento: 04/09/2026
        · Vencido hace 13 día(s)" (antes: "20/10/2026 · 33 días restantes", la fecha genérica del
        control).
      - Dashboard, período setiembre: PDT 601/621 pasan de "Vencidas: 0/0" a "Vencidas: 255/255" (nadie
        entregó y las 8 actividades del calendario ya vencieron respecto a hoy, 17 de setiembre).
      - Dashboard, período agosto (sin calendario `pdt_601`/`pdt_621` configurado — fuera de alcance de
        esta limpieza, §2.6): números idénticos a antes del cambio (fallback correcto, sin regresión).

### 5.8 Pendiente de decisión con el usuario

- [x] **§5.7 (el más importante)** — ✅ decidido e implementado 2026-09-17, ver §5.7b.
- [x] §5.6 — ✅ **replanteado 2026-09-17, ver §5.9**: en vez de hacer que el loop de 6h sincronice
      más períodos, se decidió dejar de depender de `general_status` para "Cumplimiento %" — el
      cálculo pasa a hacerse en vivo, igual que ya funciona §5.7. El mecanismo de períodos
      (`supervisor_periods`/`supervisor_monthly_controls`) **sigue siendo necesario** (es lo que
      agrupa empresa+período+declaraciones, ver §5.9.0) — lo que se descarta es depender de él para
      medir cumplimiento. El loop de 6h en sí **no se elimina**: queda como candidato a reutilizarse
      para notificaciones u otras automaciones (fuera de alcance de esta sección, anotado para
      después).
- [ ] §5.1/§5.5: decidir si `risk_level` y el estado manual "al día" son funciones a promover
      (capacitar al equipo para que las use) o a simplificar/quitar, igual criterio que se aplicó a
      NPS y a los campos de la pestaña Declaraciones (0% de uso real). Con §5.9 implementado, esto
      pierde urgencia (ya no alimenta ningún número visible del dashboard), pero sigue siendo un
      campo sin uso real que vale la pena resolver en algún momento.
- [ ] §5.2: decidir si el filtro "Responsable" debe acotarse a usuarios que efectivamente tienen
      empresas asignadas (`accountant_user_id`), o si el dato de origen (`companies.accountant_user_id`)
      necesita individualizarse primero — eso último es trabajo de datos, no de este dashboard.

## 5.9 Rediseño — "Cumplimiento %" en vivo, reemplaza a `general_status` (2026-09-17)

### 5.9.0 Contexto de negocio (aportado por el usuario, confirmado con el estudio)

- **Todas las actividades del calendario son lo que se controla realmente.** PDT 601 y PDT 621 ya
  están parametrizados por grupo de RUC (Sección 2); el resto de actividades del catálogo puede
  parametrizarse más adelante (hoy están en `other` a propósito, no por descuido — ver §2.3). El
  cumplimiento de asistentes y supervisores se mide contra ESE calendario, no contra el control
  general.
- **El período (`supervisor_periods`/`supervisor_monthly_controls.period_ym`) es el mismo en toda la
  app** — confirmado en código: PDT 601, PDT 621, Detracciones y Buzón SOL filtran todos por la misma
  columna `period_ym`, y los 4 exigen que el período esté abierto (`validateOpenPeriod`) para poder
  entrar. El Dashboard y Reportes usan el mismo campo pero **no** exigen que el período exista (solo
  validan el formato `YYYY-MM`) — inconsistencia real, anotada, no bloqueante para esta sección.
- **El día 20 de `periodDefaultDueDate` no es arbitrario**: el estudio tiene una reunión real cada 20
  de mes donde se revisa el cumplimiento del período anterior con supervisores y asistentes (coherente
  con "se trabaja pasando el mes" — en setiembre se controla lo de agosto, cuya reunión de corte es el
  20 de setiembre). Esto **corrige una lectura anterior** de este documento, que había sugerido ese
  campo como candidato a simplificar por "confuso" — no lo es, modela un proceso real.
- **Conclusión operativa**: no tiene sentido seguir dependiendo de `general_status` (marcado a mano,
  0% de uso real, §5.5) para medir cumplimiento, cuando el dato real de cumplimiento ya se calcula en
  vivo por actividad desde hace rato (§5.7 lo probó para PDT 601/621). La solución correcta no es
  "sincronizar más seguido" (§5.6 original) sino **dejar de depender de un campo que nadie llena**.

### 5.9.1 Qué módulos ya calculan cumplimiento en vivo hoy (investigado 2026-09-17)

Los 4 módulos con calendario parametrizado (§2.3: solo `pdt_601`, `pdt_621`, `detracciones` y
`sunat_inbox` tienen lógica de evaluación de cumplimiento construida) ya usan el mismo mecanismo base
(`ComputeCalendarActivityTimeliness`/`ComputeActivityRuleTimeliness`/`EvaluateUploadTimeliness`,
`upload_timeliness.go`), pero con **formas de dato muy distintas**:

| | PDT 601/621 | Detracciones | Buzón SOL |
|---|---|---|---|
| Función de agregado por período | `PdtDashboardSummary` (ya existe) | **no existe** | **no existe** |
| Unidad de Timeliness | 1 por declaración/empresa/período | 1 por declaración/empresa/período | 1 por (semana × slot × SUNAT/SUNAFIL) — **muchas por empresa/período** |
| Exención (no cuenta ni a favor ni en contra) | `sin_planilla`/`suspendida` | `sin_clave`/`no_corresponde` | **no existe** — siempre las `semanas × slots × 2` |
| Creación para todas las empresas activas | Sí (la consulta del dashboard las trae todas) | No — perezosa, filas "virtuales pendiente" para las que no tienen declaración | No — perezosa, slots "virtuales pendiente" |

> ⚠️ **Esta fila de "Exención" quedó desactualizada por §5.9.7** (escrita después): `suspendida` deja
> de vivir en cada módulo por separado y pasa a ser un campo único y compartido
> (`SupervisorMonthlyControl.Suspendida`) — los 4 módulos, incluido Buzón SOL (que acá decía "no
> existe"), lo leen de ahí. Ver §5.9.7 para el diseño vigente; esta tabla queda como registro de cómo
> era el punto de partida, no como el diseño final.

**El problema central a resolver**: PDT601, PDT621 y Detracciones son directamente comparables (1
unidad = 1 empresa en ese módulo para ese período). Buzón SOL no — una empresa puede tener 16+ puntos
de captura trackeados en un mes (p. ej. 4 semanas × 2 slots × 2 mesas de partes). Sumarlo tal cual a
los otros 3 en una sola cuenta global haría que Buzón SOL **domine numéricamente** el "Cumplimiento %"
del estudio entero, sin que eso sea la intención.

### 5.9.2 Diseño — ✅ confirmado (título histórico: originalmente "pendiente de confirmación en 2 puntos")

**Paso 1 — un solo veredicto por (empresa, módulo, período)**, mismo peso para los 4 módulos:

- Detracciones: usa directamente su `Timeliness` ya calculado (`on_time` / `late` / `missing` /
  `pending` / `exempt` / `no_rule`) — no hay que inventar nada nuevo acá, ver §5.9.1.
- PDT 601 / PDT 621: usan sus propios buckets (§5.9.1), **con un ajuste** — ver §5.9.2b (`observado`).
- Buzón SOL — ~~propuesta original de "un solo veredicto por empresa" (descartada)~~. **Reemplazada
  por §5.9.6.4**: no hay un solo veredicto por empresa — SUNAT y SUNAFIL cuentan por separado, 16
  unidades independientes por empresa/mes, cada una con su propio veredicto. Ver §5.9.6 para el
  detalle completo (esta sección quedó desactualizada por la investigación posterior, no borro el
  historial pero la propuesta de acá ya no aplica).

**Paso 2 — fórmula del "Cumplimiento %"**: `on_time / (on_time + late + missing)` (las 5 categorías de
§5.9.3 — `late` y `missing` son las dos formas de "no cumplió a tiempo", se suman para el %), sumando
los veredictos de los 4 módulos para todas las empresas del período (mismos filtros que hoy: empresa/
responsable/supervisor/riesgo — este último ya vimos que no sirve de nada real, §5.1, pero se mantiene
el filtro por si se recupera su uso).

- `exempt` y `no_rule` (período sin calendario configurado) — **no cuentan ni a favor ni en contra**,
  se excluyen del denominador (mismo criterio "no castigar por falta de configuración" de toda la
  Sección 2).
- `pending` (todavía no vence, no se le pasó la fecha límite) — ✅ **CONFIRMADO (2026-09-17)**: se
  excluye del denominador (una obligación que recién el día 20 vence no cuenta como "incumplida" el
  día 5) y se muestra aparte ("180 de 220 obligaciones ya resueltas, 92% a tiempo — 40 todavía sin
  vencer"). El cálculo es "a hoy, de lo que ya debía estar resuelto, cuánto se cumplió a tiempo" — no
  "de todo lo del mes, cuánto ya se cumplió", que es lo que hacía `general_status` y por qué daba 0%
  siempre temprano en el mes.

**Alcance explícito — qué NO entra**: los tipos de declaración SIRE y Renta Anual (sin calendario
parametrizado hoy), y cualquier otra actividad del calendario financiero que siga tipada `other` sin
su propia parametrización todavía (enums distintos — `SupervisorDeclarationType` vs
`CalendarActivityType` — que solo se correlacionan de forma laxa, no hay que confundirlos). El número
y la etiqueta en el dashboard deben decir explícitamente *"Cumplimiento (PDT 601/621, Detracciones,
Buzón SOL)"*, no un genérico "Cumplimiento %" que sugiera que cubre el 100% del trabajo del estudio —
sería engañoso mientras esos otros módulos no tengan su
propio calendario.

### 5.9.2b PDT 601/621 — qué hacer con `observado`, confirmado con el usuario 2026-09-17

Hoy `pdtBucketsSelectSQL` excluye `observado` del cálculo de `vencido`/`pendiente`
(`d.status <> observadoStatus` en ambas condiciones) — una declaración observada nunca se clasifica
como vencida ni pendiente en el agregado, sin importar cuánto tiempo lleve sin resolverse.

✅ **DECIDIDO**: `observado` se evalúa **igual que `pendiente`, por fecha**, mientras siga sin
resolverse — si ya pasó la fecha límite del calendario y sigue observada (el asistente todavía no
"levantó" la observación), cuenta como `vencido`/`missing`; si no pasó, cuenta como `pending`. El
usuario dio el ejemplo exacto: una entrega vence hoy, el supervisor la observa hoy mismo, el asistente
debía corregir y reentregar ese mismo día pero lo hace recién mañana — ya pasada la hora límite. Una
vez que se resuelve (vuelve a "Entregado"), esa nueva entrega ya se compara contra el plazo con la
lógica que **ya existe** (`entregado_a_tiempo`/`entregado_fuera_de_fecha`, sobre `fecha_entrega`) — no
hace falta nada especial para ese caso, ya funciona.

**Cambio de código real, no solo de criterio**: hay que sacar la exclusión `d.status <>
observadoStatus` de las condiciones `vencido`/`pendiente` en `pdtBucketsSelectSQL`
(`supervisor_service.go`) — una vez sacada, una declaración observada cae naturalmente en vencido o
pendiente según la misma fecha límite por grupo de RUC que ya usa el resto de la función (§5.7). La
tarjeta separada "Declaraciones observadas" (cuenta cruda de `status = observado`) **no se toca** — es
una métrica distinta (cuántas hay en revisión), no afecta a "Cumplimiento %".

### 5.9.3 Qué partes del dashboard cambian

- **Tarjeta "Cumplimiento %"** → nueva fórmula en vivo (§5.9.2), ya no lee `general_status`.
- **"Distribución por estado" (donut)** → deja de usar
  `al_dia`/`pendiente`/`vencido`/`observado`/`cerrado` (categorías del control general, sin relación
  con esto) y pasa a mostrar **5 categorías** (✅ confirmado 2026-09-17 — el usuario pidió distinguir
  esto, no simplificarlo): **Cumplido a tiempo / Entregado fuera de fecha / Vencido sin entregar /
  Pendiente (sin vencer) / Exento o no aplica**, sumando los 4 módulos. "Entregado fuera de fecha"
  (sí se entregó, pero tarde) y "Vencido sin entregar" (nunca se entregó) quedan separados — son
  situaciones distintas para decidir a quién presionar. Coincide 1 a 1 con los valores que ya
  devuelve `UploadTimelinessDTO.Timeliness` (`on_time`/`late`/`missing`/`pending`/`exempt`/`no_rule`,
  `upload_timeliness.go`) — Detracciones y Buzón SOL ya exponen exactamente esta granularidad sin
  cambios; PDT 601/621 la arma desde sus propios buckets
  (`entregado_a_tiempo`→on_time, `entregado_fuera_de_fecha`→late, `vencido`→missing,
  `pendiente`→pending, `sin_planilla` (propio del módulo) + `control.Suspendida` (compartido,
  §5.9.7)→exempt). Fórmula del % sigue siendo
  `on_time / (on_time + late + missing)` — las 2 categorías de incumplimiento se suman para el
  porcentaje, solo se muestran separadas en el donut.
- **"Tendencia de cumplimiento (6 meses)"** → misma fórmula nueva, aplicada a cada uno de los últimos
  6 períodos (reemplaza `ComplianceTrend`, que hoy también lee `general_status`).
- **"Productividad por supervisor"** → se reagrupan los mismos veredictos por
  `supervisor_monthly_controls.supervisor_user_id` (se mantiene esta fuente — es la misma que ya usan
  todos los filtros del dashboard hoy, por consistencia) en vez de contar `general_status = al_dia`.
- **Lo que NO cambia**: los 6 resúmenes propios de cada módulo (las tarjetas PDT 601/PDT 621 con sus
  propios "Pendientes/Vencidas/Completadas", el desglose por asistente) — siguen calculándose igual
  que hoy, esto solo afecta al número agregado de portada y sus 3 visualizaciones.

### 5.9.4 Nota de implementación — costo de calcular Buzón SOL en vivo

A diferencia de PDT601/621/Detracciones (agregables con una sola consulta SQL tipo
`pdtBucketsSelectSQL`), Buzón SOL resuelve su fecha límite por slot **en código Go**
(`dueDateForMailboxSlot`/`mailboxDueDaysInWeek`), no en SQL — para las 328 empresas del estudio, esto
implica iterar semanas × slots en memoria, no una sola query agregada. Hay que fijarse en el costo
real (probablemente aceptable dado que ya se usa así para `ListSunatInboxMonth`/`ExportSunatInbox`,
pero nunca se corrió para las 328 empresas de una sola vez como pide un dashboard) antes de dar esto
por cerrado — verificar con datos reales, no asumir.

### 5.9.5 Checklist

> ⚠️ **Orden de implementación**: §5.9.7 (campo global `SupervisorMonthlyControl.Suspendida`) es
> **prerequisito** de los 2 ítems de abajo que tocan `isExempt`/`pdtBucketsSelectSQL` y el agregado de
> Detracciones — si se construyen primero contra los campos viejos (`pl.suspendida`/`r.suspendida`,
> `sin_clave`/`no_corresponde` sin el flag compartido) y se corrige después, es trabajo duplicado.
> Conviene resolver §5.9.7 en la misma pasada que estos ítems, no como algo aparte después.

- [x] Confirmar con el usuario los puntos de §5.9.2 (`pending` excluido — ✅) y §5.9.2b (`observado`
      tratado como pendiente por fecha — ✅). Buzón SOL confirmado aparte en §5.9.6. Suspensión global
      confirmada en §5.9.7/§5.9.8/§5.9.9.
- [x] Backend: sacar la exclusión `d.status <> observadoStatus` de `vencido`/`pendiente` en
      `pdtBucketsSelectSQL` (§5.9.2b) — con test nuevo (observada + plazo ya vencido → cuenta como
      vencido/missing, `TestPdtBucketsSQL_ObservadoCuentaComoVencidoSiYaPaso`). `isExempt` ya lee
      `control.Suspendida` (§5.9.7.3 punto 2) en vez de `pl.suspendida`/`r.suspendida`.
- [x] Backend: función de agregado nueva para Detracciones (`DetraccionesDashboardSummary`,
      `supervisor_compliance_summary.go`) — su exención ya lee `control.Suspendida` además de
      `sin_clave`/`no_corresponde` (vía `computeDetraccionesTimeliness`).
- [x] Backend: función combinadora — **etapa 1**, solo PDT 601/PDT 621/Detracciones
      (`MonthlyComplianceSummary`, `supervisor_compliance_summary.go`) — suma los 3 módulos y devuelve
      `ComplianceSummary` (on_time/late/missing/pending/exempt + el % ya calculado), reutilizada por
      Dashboard, ComplianceTrend y SupervisorComplianceRanking. La etiqueta del dashboard dice
      *"Cumplimiento (PDT 601/621, Detracciones)"* en esta etapa 1.
- [x] Backend: `Dashboard`/`ComplianceTrend`/`SupervisorComplianceRanking` (`supervisor_service.go`)
      usan la función combinadora en vez de `general_status`. `ReportProductivity` (por responsable) NO
      se tocó — sigue con `general_status`, fuera del alcance de esta sección.
- [x] Frontend: tarjeta, donut (5 categorías) y label actualizados en `SupervisorDashboard.tsx`/
      `DashboardCharts.tsx` para decir explícitamente qué módulos cubre (etapa 1: PDT 601/621 +
      Detracciones).
- [x] Tests: `supervisor_compliance_summary_test.go` — un caso por módulo (Detracciones: missing/
      pending/exempt×2/on_time; combinadora; `observado` de §5.9.2b).
- [ ] **Etapa 2 (Buzón SOL, después)**: función de resumen por empresa/período (16 unidades, §5.9.6.4),
      sumada a la combinadora; medir el costo real de calcularla para las 328 empresas antes de dar por
      cerrado (§5.9.4); actualizar la etiqueta del dashboard para incluir Buzón SOL. **No implementado
      todavía** — solo se hizo el badge visual de suspendida (§5.9.8), que no depende de esto.

## 5.9.6 Buzón SOL — investigación profunda contra el proceso real del estudio (2026-09-17)

El usuario pidió cerrar bien Buzón SOL antes de seguir con PDT/Detracciones, porque es el módulo con
la estructura más distinta. Se contrastó la descripción del proceso real (dada por el usuario, quien la
confirmó con el estudio) contra el código y los datos reales de setiembre 2026.

### 5.9.6.1 Lo que coincide con el código actual

- Corte por **hora**, no por día: antes de las 10:30 = "presentado", después = "presentado fuera de
  hora" — mismo día, no al día siguiente. Ya implementado (`ActivityRule` id=2 "CONTROL DE HORA",
  `compare_mode=datetime`, `max_upload_time=10:30`, confirmado en BD).
- 2 cargas por semana (`mailbox_captures_per_week=2` en `firm_config`, confirmado en BD).
- SUNAT y SUNAFIL se evalúan **de forma independiente**, no como una sola unidad combinada — el
  usuario lo confirmó explícitamente: *"si un día carga uno solo, por ejemplo solo carga buzón SUNAT
  pero falta SUNAFIL, solo cuenta una carga según el horario que cargó y una [fila] queda pendiente de
  cumplimiento"*. Esto coincide exactamente con cómo ya está hecho el código
  (`slot.Sunat.Timeliness`/`slot.Sunafil.Timeliness`, calculados por separado, `sunat_inbox_timeliness.go:122-134`).
  **Conclusión de diseño**: la unidad de conteo NO es "1 carga = 2 buzones juntos" — son dos unidades
  independientes por carga (SUNAT y SUNAFIL), cada una con su propio veredicto on_time/late/pending.

### 5.9.6.2 Lo que NO coincide — el calendario real está mal configurado (mismo problema que PDT601/621 antes de la Sección 2)

Confirmado en la BD: la actividad que hoy alimenta Buzón SOL en setiembre
(`REVISION DE BUZON ELECTRONICO SUNAT Y SUNAFIL`, id 162) tiene **`start_day=23, end_day=23,
due_day=23`** — un solo día fijo del mes, todavía tipada `nps` (nunca se retipeó, quedó fuera del
alcance de la Sección 2). Con esa configuración, `mailboxDueDaysInWeek` solo encuentra una fecha real
para la semana que contiene el día 23; las otras 3 semanas caen al reparto matemático artificial
(`mailboxSlotDefaultDueDay`), que no corresponde a miércoles ni a sábado reales.

✅ **DECIDIDO (2026-09-17, confirmado por el usuario)**: hay que corregir esto — las cargas del mes
siempre son 8 (2 por semana × 4 semanas), y el día exacto (miércoles/sábado) es **movible por feriados**
vía el mismo mecanismo de arrastrar-y-soltar del calendario que ya existe para otras actividades (si un
sábado cae feriado, la carga se mueve a viernes o lunes).

**Esto implica una limitación de código, no solo de datos** — a diferencia de PDT601/621 (2 y 6
actividades por período, elegidas por **dígito de RUC** vía `PickCalendarActivityByDigit`), Buzón SOL
necesitaría **8 actividades de calendario por mes** (una por cada ocurrencia de miércoles/sábado),
elegidas por **coincidencia de semana/slot**, no por RUC — un criterio de selección distinto que hoy no
existe. `FindSunatInboxCalendarActivity` (`sunat_inbox_timeliness.go:18-49`) solo trae **una** actividad
por período (`First(&act)`, ordenada por `due_day`) — con 8 actividades reales configuradas, seguiría
trayendo solo la primera e ignorando las otras 7. Se necesita una función nueva, análoga a
`CalendarActivitiesForType`+`PickCalendarActivityByDigit`, pero que elija por semana/slot en vez de por
dígito.

### 5.9.6.3 `weeksInPeriodYM` no siempre da exactamente 4 semanas — resuelto, no afecta el conteo

Se le consultó al usuario si la semana parcial de inicio/fin de mes (setiembre 2026: 1-2 de setiembre,
antes del primer lunes 7) suma cargas extra. ✅ **RESUELTO (2026-09-17)**: no — **las cargas del mes
son siempre 8**, sin importar cuántas "semanas" tenga el calendario según `weeksInPeriodYM`. Lo normal
es 2 por semana × 4 semanas, pero el día concreto es movible (feriados); lo que se evalúa siempre es la
hora de carga contra el slot que le corresponde, no la cantidad de "semanas" que devuelva ese helper.

**Implicación de diseño importante**: `weeksInPeriodYM` (y el parámetro `week_start` que se ve en la
URL del módulo, `/assistant/activities/sunat-inbox?period_ym=...&week_start=...`) es un eje de
**navegación/carga** (para que el asistente sepa en qué semana subir su captura) — **no** es el eje que
debe usarse para calcular el cumplimiento mensual. El modelo de cumplimiento debe tratarse como **8
slots fijos por mes**, cada uno con su propia actividad de calendario (día específico, movible), igual
en espíritu a como PDT 621 tiene 6 actividades fijas por grupo de RUC — no como "N semanas que
resulten de iterar el mes".

### 5.9.6.4 Definición final de la unidad de conteo — confirmado 2026-09-17

✅ **DECIDIDO**: SUNAT y SUNAFIL cuentan **por separado** (no un AND) — **16 unidades por mes**
(8 slots × 2 buzones), cada una con su propio veredicto `on_time`/`late`/`pending`/`missing`. Fórmula:
`% = unidades on_time / (on_time + late + missing)` — igual que el resto de la Sección 5.9 (§5.9.3),
`pending` excluido del denominador (✅ confirmado en §5.9.2, ya no está abierto).

~~❓ Pregunta que nunca se había hecho: PDT 601 tiene `sin_planilla`/`suspendida` como exención,
Detracciones tiene `sin_clave`/`no_corresponde` — Buzón SOL no tiene ningún mecanismo de exención hoy
(`exempt` hardcodeado en `false`). ¿Existe algún caso real donde una empresa no deba controlarse por
Buzón SOL?~~ **✅ RESUELTA en §5.9.7**: sí hacía falta, y quedó resuelta de yapa — Buzón SOL ahora
también lee `control.Suspendida` (el campo global compartido de §5.9.7), sin necesitar ningún mecanismo
propio. Dejo la pregunta original tachada, no borrada, como registro de por qué se llegó a §5.9.7.

### 5.9.6.5 Checklist Buzón SOL (se suma al checklist general de §5.9.5)

- [x] Confirmar §5.9.6.3 (semana parcial no suma cargas — siempre 8 fijas) y §5.9.6.4 (16 unidades/mes,
      SUNAT+SUNAFIL por separado).
- [x] Retipear la plantilla `REVISION DE BUZON ELECTRONICO SUNAT Y SUNAFIL` (AC11) a `sunat_inbox`
      (2026-09-17, hecho por el navegador en local dev, usuario `admin1`, vía
      `/finance/activity-templates/11/edit`) — el select mostraba "PDT 601" en vez del tipo real porque
      el valor guardado (`nps`) ya no existe entre las opciones válidas (NPS se eliminó, §1). El
      duplicado `AC17` ("REVISION DE BUZON ELECTRONICO SUNAT Y SUNAFIL,", con coma, sin regla asignada)
      se dejó tal cual — no tenía ninguna actividad de calendario propia después de la limpieza de
      abajo, no hacía falta tocarlo.
- [x] Configurar 8 actividades de calendario reales por mes (una por miércoles/sábado) — hecho para
      setiembre 2026 (2026-09-17) **por SQL directo** contra la BD de dev (`finance_calendar_activities`),
      mismo criterio que el ajuste de `activity_rule_id` de §2.8: se encontraron 5 actividades viejas mal
      tipadas (`nps`, `activity_rule_id` NULL salvo la del día 23) en los días 6/13/20/23/27 —
      **domingos**, ninguna coincidía con miércoles/sábado real — se dieron de baja (soft-delete) y se
      crearon 8 nuevas desde la plantilla AC11 ya corregida, una por cada miércoles/sábado real de
      setiembre (días 2, 5, 9, 12, 16, 19, 23, 26), todas `sunat_inbox` + `activity_rule_id=2` (CONTROL
      DE HORA). Verificado en `/finance/calendar` (aparecen en los días correctos) y contra la API real
      del módulo (`GET .../activity-modules/sunat-inbox?period_ym=2026-09&week_start=2026-09-14`): el
      slot 1 de esa semana ahora resuelve `due_at=2026-09-16T10:30` (miércoles real) y el slot 2
      `due_at=2026-09-19T10:30` (sábado real), en vez del reparto matemático artificial de antes.
- [x] Backend: nueva función de selección por slot fijo — `sunatInboxCalendarActivitiesForPeriod`
      (`sunat_inbox_timeliness.go`) trae TODAS las actividades tipo `sunat_inbox` del período (reusa
      `CalendarActivitiesForType`, ya existente) en vez de una sola; `mailboxDueDatesInWeekFromActivities`
      junta las fechas reales de todas las actividades que caen en una semana dada, ordenadas
      cronológicamente, y `dueDateForMailboxSlot` elige por posición (slot 1 = la más temprana). Cae al
      reparto matemático de siempre si no hay ninguna actividad real en la semana (calendario sin
      retipear). `mailboxTimelinessCtx.calendarAct` (uno) pasó a `calendarActs` (varios) — actualizados
      todos los call sites y los tests existentes (`sunat_inbox_timeliness_test.go`), más un test nuevo
      (`TestDueDateForMailboxSlot_usesDiscreteRealActivities`) para el caso de actividades discretas.
- [x] Backend: función de resumen por empresa/período (`SunatInboxDashboardSummary`,
      `supervisor_sunat_inbox_summary.go`) que suma las unidades on_time/late/pending/missing/exempt
      del mes (`sunatInboxRealSlotsForPeriod` en `sunat_inbox_timeliness.go` agrupa las actividades de
      calendario reales en semana+slot, mismo criterio que ya usa el resto del módulo) — sumada a
      `MonthlyComplianceSummary` (etapa 2 completa: PDT 601/621 + Detracciones + Buzón SOL). Etiqueta
      del dashboard actualizada a "Cumplimiento (PDT 601/621, Detracciones, Buzón SOL)". Tests en
      `supervisor_sunat_inbox_summary_test.go` (agrupación por semana, missing/on_time/exempt).
      **Costo real medido, no asumido (§5.9.4)**: contra las 255 empresas activas del dataset de dev,
      la primera versión (`ComputeActivityRuleTimeliness` por unidad, sin cache de la regla) generaba
      >4000 consultas individuales a `activity_rules` dentro de un solo request y hacía fallar el
      dashboard en la práctica (`net::ERR_FAILED`, confirmado en el navegador) — se corrigió
      precargando la regla una sola vez por id distinto (normalmente 1) en vez de una consulta por
      unidad evaluada; verificado de nuevo en el navegador tras el fix, responde 200 OK.

## 5.9.7 "Suspendida" pasa a ser global por período (2026-09-17)

### 5.9.7.1 Contexto y decisión

El usuario notó que "suspendida" hoy vive por separado en cada módulo (PDT601, PDT621) y pidió
manejarlo de forma global: si una empresa está suspendida, **ninguna** de sus actividades del
calendario debe contar para el cumplimiento — sin tener que marcarlo módulo por módulo.

✅ **DECIDIDO (2026-09-17)**:
- **Por período**, no persistente a nivel empresa — se marca en la "carpeta" compartida
  (`SupervisorMonthlyControl`, 1 por empresa+período, la misma que se explicó en §5.9.0), no en
  `Company`. Si sigue suspendida el mes siguiente, se vuelve a marcar ese período — mismo criterio que
  ya usa hoy PDT601/621 (no es un cambio de comportamiento, solo de dónde vive el dato).
- **Sigue apareciendo en listados y exports Excel** de PDT 601/621 (y ahora también Detracciones) **con
  su estado real** ("Suspendida") — no desaparece de la vista. Esto ya es así hoy para PDT601/621
  (`pdt601DisplayStatus` prioriza Suspendida sobre el resto), no cambia.
- **No cuenta para "Cumplimiento %"** — es la 5ª categoría "exempt" de §5.9.3, igual que
  `sin_planilla`/`sin_clave`/`no_corresponde`.
- **Debe verse cuántas empresas están suspendidas**, de forma coherente entre módulos — hoy cada
  módulo tiene su propio mini-stat "Suspendida" (`PdtMiniStat`); con el campo compartido, PDT601 y
  PDT621 van a mostrar **el mismo número** para un período dado (antes podían diferir, ya que cada uno
  tenía su propio flag) — eso es intencional, es la prueba de que quedó unificado.
- **Detracciones necesita un botón nuevo** — hoy no tiene forma de marcar una empresa suspendida (solo
  tiene `sin_clave`/`no_corresponde`, conceptos distintos a "suspendida temporalmente"). Hay que
  agregarlo a `DetraccionesDetailPage.tsx`.

### 5.9.7.2 Cómo funciona hoy (investigado, para no romper la UX que ya funciona)

`Suspendida` vive hoy en `SupervisorPdt601Planilla.Suspendida`/`SupervisorPdt621Record.Suspendida`
(campo propio de cada módulo) — confirmado en BD: solo 2 empresas marcadas así hoy (ambas en PDT601,
agosto 2026; cero en PDT621 — otra prueba de que no está ni siquiera sincronizado entre los dos
módulos hermanos). En el frontend (`Pdt601DetailPage.tsx:694-718`) es un checkbox dentro del propio
formulario de planilla: al marcarlo, bloquea **todo** el resto del formulario (fuerza una nota fija en
Observaciones, es mutuamente excluyente con "Sin planilla", bloquea Aprobar/Observar), y lo puede
marcar tanto el asistente como el supervisor. Este comportamiento visual/UX **se mantiene igual** — lo
que cambia es a qué campo escribe.

También se confirmó: no existe ningún flag persistente de "empresa suspendida" a nivel `Company` — lo
único parecido es el "estado"/"condición" de SUNAT que se trae una sola vez al crear la empresa (vía
ApiPeru.dev), como aviso transitorio, no como dato que se vuelva a consultar. No es la misma fuente ni
sirve para este propósito (no se actualiza solo si SUNAT cambia el estado del RUC después).

### 5.9.7.3 Diseño propuesto — ✅ confirmado 2026-09-17: Detracciones es el ÚNICO lugar donde se marca

El usuario aclaró algo importante que cambia el diseño: **Control de Detracciones es la primera
actividad del flujo del estudio cada período** — por eso es el único lugar donde se marca/desmarca
"suspendida". Los demás módulos (PDT 601, PDT 621, Buzón SOL) son **de solo lectura** para esto: si
otro usuario entra a esas pantallas, simplemente ve "Suspendida" y no puede hacer nada más ahí — no
hay un botón propio para marcarlo desde esos otros módulos.

1. **Backend**: agregar `Suspendida bool` a `SupervisorMonthlyControl` (campo nuevo, default `false`).
2. **Backend**: los puntos que hoy calculan "exempt" pasan a leer `control.Suspendida`:
   - `isExempt` en `pdtBucketsSelectSQL` (hoy: `pl.suspendida`/`r.suspendida` por tipo) — agregar `OR
     c.suspendida` (con `c` = `supervisor_monthly_controls`, ya está en el JOIN).
   - `detraccionesIsExemptStatus` — hoy solo mira el status de la declaración; pasa a mirar también
     `control.Suspendida`.
   - `enrichSunatInboxMailboxSideTimeliness` — **responde la pregunta abierta de §5.9.6.4**: Buzón SOL
     no tenía NINGÚN mecanismo de exención (`exempt` hardcodeado en `false`); ahora sí lo tiene, vía
     este mismo campo compartido — sin necesitar nada propio de Buzón SOL.
3. **Backend**: endpoint para marcar/desmarcar, expuesto **solo** desde el flujo de Detracciones (p.
   ej. parte de `SaveDetraccionesXxx` o un endpoint dedicado llamado únicamente por
   `DetraccionesDetailPage.tsx`) — no expuesto desde PDT601/621.
4. **Frontend — Detracciones (`DetraccionesDetailPage.tsx`)**: agregar el checkbox/botón nuevo
   ("Marcar como suspendida"), con el mismo bloqueo total del resto del formulario mientras esté
   marcada — mismo patrón UX que ya existe hoy en PDT601 (§5.9.7.2), aplicado acá por primera vez.
5. **Frontend — PDT601/PDT621**: **se saca el checkbox** de `Pdt601DetailPage.tsx`/
   `Pdt621DetailPage.tsx` (ya no se marca desde ahí) — se reemplaza por un aviso de solo lectura
   ("Esta empresa está suspendida en este período — marcado desde Control de Detracciones") cuando
   `control.Suspendida` es verdadero, con el mismo bloqueo del resto del formulario que ya tenían. **Los
   filtros de listado ("Suspendida" en `PDT601_STATUS_FILTER`/equivalente PDT621) siguen funcionando
   igual** — siguen mostrando las empresas suspendidas, solo cambia de dónde sale el dato.
6. **Migración**: ✅ **confirmado** — las 2 filas ya marcadas suspendidas en `Pdt601Planilla` se migran
   a `control.Suspendida`, y los campos viejos (`Pdt601Planilla.Suspendida`/`Pdt621Record.Suspendida`)
   **se eliminan** después de migrar — no se mantienen dos fuentes de verdad.

### 5.9.7.4 Una pregunta que queda, derivada de la aclaración de arriba

Con Detracciones como único lugar de marcado, con bloqueo total del formulario (punto 4) — ¿es
correcto asumir que **Buzón SOL no necesita ningún control propio, ni de lectura especial** más allá
de excluir esas empresas del cálculo de cumplimiento (§5.9.7.3 punto 2)? Dado que Buzón SOL no tiene
una pantalla de "detalle por empresa" igual a las otras (es captura semanal por slot), no veo dónde
mostraría un aviso de "suspendida" aunque quisiera — solo lo dejaría afuera del cálculo, sin avisar
visualmente en esa pantalla. Confirmame si eso es suficiente o si hace falta algo más ahí.

### 5.9.7.5 Checklist

- [x] Confirmar §5.9.7.4 — ✅ resuelto en §5.9.8: Buzón SOL sí necesita aviso visual (badge en el
      listado), no queda sin ningún indicador.
- [x] Backend: agregar `SupervisorMonthlyControl.Suspendida` + migración
      (`migSuspendidaGlobalPorControl`, `supervisor_migrations.go`).
- [x] Backend: endpoint de marcar/desmarcar (`PUT .../detracciones/companies/:companyId/suspendida`,
      `DetraccionesSetSuspendidaAPI`), expuesto solo desde el flujo de Detracciones.
- [x] Backend: `isExempt` (PDT601/621) y `detraccionesIsExemptStatus`/`computeDetraccionesTimeliness`
      leen el campo compartido. Buzón SOL (`enrichSunatInboxMailboxSideTimeliness`) **no** se tocó —
      su timeliness no distinguía exención por suspendida antes de este cambio tampoco; el badge de
      §5.9.8 es solo visual, no afecta su cálculo de puntualidad (queda anotado como pendiente si se
      necesita más adelante).
- [x] Backend: migradas las filas existentes y **eliminados** los campos viejos
      (`Pdt601Planilla.Suspendida`/`Pdt621Record.Suspendida`) — incluye los tipos TypeScript
      correspondientes (`Pdt601Planilla`/`Pdt621Record`/`*Input` en `frontend/src/services/`).
- [x] Frontend: control de suspensión (checkbox + bloqueo total del formulario) agregado a
      `DetraccionesDetailPage.tsx`.
- [x] Frontend: checkbox sacado de `Pdt601DetailPage.tsx`/`Pdt621DetailPage.tsx`, reemplazado por
      aviso de solo lectura cuando `control_suspendida` es verdadero — bloquea el resto del formulario
      (`formLocked = declarationLocked || controlSuspendida`).
- [x] Frontend: badge "Suspendida" en el listado de Buzón SOL (§5.9.8) — ver nota de alcance en
      §5.9.8, se mantiene la grilla de slots visible junto al badge (no se ocultó).
- [ ] Verificar que los mini-stats "Suspendida" de PDT601 y PDT621 den el mismo número para un mismo
      período — no verificado manualmente contra datos reales todavía (sí cubierto por los tests
      unitarios `TestPdt601BlockedWhenControlSuspendida`/`TestPdt621BlockedWhenControlSuspendida`).

## 5.9.8 Buzón SOL — sí necesita aviso visual de suspendida (2026-09-17)

✅ **DECIDIDO**: aunque Buzón SOL no tiene pantalla de detalle por empresa (es captura semanal por
slot), **sí hace falta mostrar algo** para las empresas suspendidas — el usuario señaló el riesgo real:
si una empresa suspendida simplemente desaparece de la vista sin ninguna marca, alguien puede pensar
que la empresa se eliminó o que algo falló, en vez de entender que está suspendida a propósito.

**Dónde mostrarlo**: en el listado semanal (`ListSunatInbox`/`ListSunatInboxMonth`,
`/assistant/activities/sunat-inbox`), la empresa debe seguir apareciendo en la fila (no ocultarse) con
un indicador visual de "Suspendida" — mismo criterio visual que ya usan PDT601/621/Detracciones (badge
morado, fuera de la grilla de slots normal). No hace falta un aviso "de formulario" porque no hay
formulario por empresa acá, alcanza con la marca en la fila del listado.

### 5.9.8 Checklist

- [x] Backend: `SunatInboxListRow`/`SunatInboxExportRow` exponen `suspendida` (leído de
      `control.Suspendida`, §5.9.7).
- [x] Frontend: fila de empresa suspendida en el listado semanal/mensual de Buzón SOL — badge morado
      "Suspendida" junto al nombre. **Desviación de lo documentado**: se mantiene la grilla de slots
      normal visible (no se ocultó) — más simple de implementar y no pierde información si la
      suspensión fue reciente; revisar con el usuario si de verdad hace falta ocultarla.

## 5.9.9 Alerta de arrastre de suspensión entre períodos (2026-09-17)

### 5.9.9.1 El problema

Como "suspendida" es **por período** (§5.9.7 — no persiste sola de un mes al otro), una empresa
suspendida en agosto vuelve a `false` automáticamente en setiembre en cuanto se bootstrapea el control
nuevo — nadie decide activamente "reactivarla", simplemente el campo nace en `false` porque es un
control nuevo. Si la empresa sigue realmente suspendida (situación que dura varios meses en la
práctica — SUNAT no reactiva un RUC de un día para el otro), alguien tiene que acordarse de volver a
marcarla, mes a mes, o se cuela como si estuviera activa de nuevo sin que nadie lo haya decidido así.

### 5.9.9.2 Diseño — ✅ confirmado (título histórico: originalmente "pendiente de precisar")

✅ **DECIDIDO en principio**: al entrar a un período nuevo, si el período anterior tenía empresas
suspendidas, mostrar una alerta/modal informando la lista y preguntando qué hacer — **no es todo o
nada**: debe permitir elegir, empresa por empresa, cuáles se mantienen suspendidas para el nuevo
período y cuáles se reactivan.

Como Detracciones es el único lugar donde se marca/desmarca suspensión (§5.9.7.3), este modal
naturalmente pertenece a **Control de Detracciones** — es coherente con "la primera actividad del
período".

Propuesta de mecánica:
1. Se agrega `SuspensionCarryOverResolved bool` a `SupervisorPeriod` (default `false`) — para saber si
   ya se resolvió el arrastre de este período o todavía no, y no repetir la alerta cada vez que alguien
   entra.
2. Al abrir Control de Detracciones para un período con `SuspensionCarryOverResolved = false` **y** el
   período anterior tiene al menos 1 empresa con `control.Suspendida = true`: se muestra el modal —
   lista de esas empresas, cada una con un checkbox marcado por defecto (mantener suspendida), el
   usuario puede destildar las que quiere reactivar, confirma, y eso:
   - aplica `Suspendida = true` al control de este período para las que quedaron tildadas,
   - deja `Suspendida = false` (el valor por defecto) para las destildadas,
   - marca `SuspensionCarryOverResolved = true` para no volver a preguntar.
3. ✅ **CONFIRMADO (2026-09-17)**: si nadie interactúa con el modal (lo cierra sin decidir), **vuelve a
   aparecer** la próxima vez que alguien entre a Detracciones de ese período — no se asume "reactivar
   todas" por defecto.

### 5.9.9.3 Permisos — ✅ confirmado, sin restricción por ahora

✅ **CONFIRMADO (2026-09-17)**: por ahora, **cualquier usuario** que entre a Detracciones puede ver y
resolver el modal, sin restricción de permiso — el usuario aclaró que en la práctica así debería
trabajar hoy. Queda **anotado como pendiente a decidir más adelante** si conviene acotarlo a un
permiso de gestión/aprobación (p. ej. para que un asistente no reactive por su cuenta una empresa
suspendida) — no bloquea esta implementación, es una mejora futura.

### 5.9.9.4 Concurrencia — dos usuarios resolviendo el mismo modal al mismo tiempo

El usuario señaló un caso real no cubierto: si **dos usuarios entran al mismo tiempo** a un período con
el arrastre sin resolver, ambos ven el modal, y cada uno guarda una decisión **distinta** (p. ej. uno
mantiene las 5 empresas suspendidas, el otro reactiva 2 de esas 5) — sin control de concurrencia, el
segundo guardado pisaría al primero silenciosamente, y nadie sabría cuál de las dos decisiones quedó
vigente.

✅ **DECIDIDO**: gana **quien guardó primero** — el segundo intento debe rechazarse, no fusionarse ni
sobrescribir. Mecánica propuesta (compare-and-swap atómico, sin necesitar un lock explícito):

```go
res := database.DB.Model(&models.SupervisorPeriod{}).
    Where("id = ? AND suspension_carry_over_resolved = ?", periodID, false).
    Update("suspension_carry_over_resolved", true)
if res.RowsAffected == 0 {
    return errors.New("este arrastre ya fue resuelto por otro usuario — recargá la página")
}
// recién acá, adentro del mismo UPDATE ganador, aplicar el bulk update de Suspendida por empresa
```

El `UPDATE ... WHERE suspension_carry_over_resolved = false` solo puede tener éxito para **uno** de los
dos guardados simultáneos (el motor de base de datos serializa la fila) — el que llega segundo obtiene
`RowsAffected = 0` y se rechaza con un mensaje claro, sin tocar ningún dato. El frontend, ante ese
error, debe recargar el estado del período (ya no va a mostrar el modal, porque `resolved` ya quedó en
`true`) en vez de reintentar guardar.

### 5.9.9.5 Checklist

- [x] Backend: agregar `SupervisorPeriod.SuspensionCarryOverResolved` — campo en el modelo
      (`models/supervisor.go`).
- [x] Backend: endpoint que devuelve las empresas suspendidas del período anterior
      (`GET .../detracciones/suspension-carry-over`, `GetSuspensionCarryOverStatus`,
      `supervisor_suspension_carryover.go`).
- [x] Backend: endpoint que aplica la decisión (`POST .../detracciones/suspension-carry-over/apply`,
      `ApplySuspensionCarryOver`) — compare-and-swap atómico sobre `suspension_carry_over_resolved`
      (§5.9.9.4) antes de aplicar `SetDetraccionesSuspendida` por cada empresa que quedó tildada;
      rechaza con error claro si ya lo resolvió otro usuario, sin tocar ningún dato.
- [x] Frontend: modal en `DetraccionesListPage.tsx` (`SuspensionCarryOverModal.tsx`, nuevo
      componente) — se eligió esta página porque es donde se entra primero al período (§5.9.9.2:
      "Detracciones es la primera actividad"); lista de empresas con checkbox marcado por defecto
      (mantener suspendida); si el guardado falla, recarga el estado en vez de reintentar; si se cierra
      sin decidir, no queda nada guardado — vuelve a aparecer la próxima vez que se entre a la página
      para ese período.
- [x] Test: `supervisor_suspension_carryover_test.go` —
      `TestApplySuspensionCarryOver_SecondAttemptFailsCleanly` simula dos guardados sobre el mismo
      período (llamadas secuenciales al mismo código, no goroutines reales — sqlite en memoria de los
      tests no da mucho margen para concurrencia real, pero ejercita exactamente la misma rama de
      compare-and-swap): el segundo falla limpio y no pisa la decisión del primero.

> Nota: "agregar el control de suspensión a `DetraccionesDetailPage.tsx`" y "verificar que los
> mini-stats coincidan entre PDT601/621" son ítems de §5.9.7.5 (ya están ahí) — se habían duplicado acá
> por error al escribir esta sección, se sacaron de esta lista para no repetir el mismo trabajo dos
> veces en dos checklists distintos.
