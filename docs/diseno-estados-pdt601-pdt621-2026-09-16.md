# Diseño: unificación de estados PDT 601 / PDT 621

**Fecha**: 2026-09-16. **Solo diseño — nada implementado todavía.** Este documento es el ancla de la
conversación de diseño (varias rondas de análisis y correcciones) para no perder el criterio acordado
antes de tocar código. Cualquier cambio de criterio respecto a lo acá escrito debe reflejarse acá
mismo, no solo quedar en el chat.

---

## 1. Problema que motiva el rediseño

Auditoría previa (sin documento propio — quedó en la conversación) encontró que, tal como está hoy:

- `SupervisorDeclaration.Status` es una sola columna compartida por **7 tipos de declaración**
  (`pdt_601`, `pdt_621`, `sire`, `renta_anual`, `sunat_inbox`, `detracciones`, `distractions` legacy),
  con un enum nominal de 7 valores (`pendiente`, `en_elaboracion`, `en_revision`, `observado`,
  `aprobado`, `presentado`, `cerrado`).
- El endpoint genérico `PUT /supervisors/declarations/:id`
  (`backend/controllers/supervisor_controller.go`, `UpdateDeclarationAPI` →
  `backend/services/supervisor_service.go`, `UpdateDeclaration`) **no valida transiciones** para
  PDT601/PDT621 — acepta cualquier valor, desde cualquier estado, en cualquier momento. La única
  excepción real en todo el código es **Detracciones**, que sí bloquea el PUT genérico y fuerza el uso
  de endpoints dedicados con precondiciones (prueba de que el patrón "correcto" existe en el código,
  simplemente nunca se aplicó a PDT601/621).
- PDT601 restringe (solo en el frontend, no en el servidor) qué puede elegir cada rol en el select
  "Cambiar estado", y bloquea la edición del formulario para el asistente una vez aprobado
  (`assistantLocked`, `Pdt601DetailPage.tsx`). **PDT621 no tiene ninguna de las dos cosas**: el select
  muestra los 7 valores a cualquier rol y no existe ningún bloqueo de edición por estado — un asistente
  puede auto-aprobarse su propia declaración desde la pantalla normal.
- `SinPlanilla`/`Suspendida` (PDT601) y `Suspendida` (PDT621) son booleanos en tablas aparte
  (`supervisor_pdt601_planillas`, `supervisor_pdt621_records`), no estados reales — pero el frontend de
  PDT601 los mezclaba visualmente con `Status` en un valor sintético (`combinedStatusValue`) como si
  fueran un único enum de 9 valores.
- El backend **sí** refuerza correctamente hoy que `Suspendida` bloquea y limpia todos los demás campos
  (verificado campo por campo en `SavePdt601Planilla` y `SavePdt621Record` — están simétricos, no hace
  falta tocar esa parte). Lo que está mal organizado es el **frontend** de PDT621: la misma cobertura
  existe, pero repartida en 4 condicionales sueltas en vez de una sola puerta (como sí hace PDT601).

## 2. Alcance

**Dentro de alcance**: `pdt_601` y `pdt_621` únicamente — su propio subconjunto de valores de
`SupervisorDeclaration.Status`, la UI de sus dos pantallas de detalle/listado, y sus dos tablas de
datos (`supervisor_pdt601_planillas`, `supervisor_pdt621_records`).

**Fuera de alcance — no se tocan**: Detracciones (ya tiene su propia máquina de estados, con sus
propios valores no relacionados: `cargado`, `verificado`, `sin_clave`, etc.), SIRE, Renta Anual, Buzón
SOL/SUNAT Inbox (su estado operativo real vive en `SupervisorMailboxCaptureSlot`, no en
`SupervisorDeclaration.Status`). Como comparten la misma columna física, el nuevo enum reducido de
PDT601/621 (4 valores) convive con los 7 valores que puedan seguir usando los demás tipos — no se
migra ni se renombra nada a nivel de columna/tabla compartida, solo se restringe qué valores son
válidos y qué transiciones se permiten **cuando `declaration_type` es `pdt_601` o `pdt_621`**.

## 3. Modelo de estados final

Se reduce de 7 a **4 valores reales**, iguales para PDT601 y PDT621:

| Valor interno | Label en pantalla | Significado |
|---|---|---|
| `pendiente` | Pendiente | Nadie hizo nada todavía este período. |
| `por_revisar` | Por revisar | El asistente entregó (hay fecha de entrega) y espera revisión del supervisor. Mismo valor tanto para la primera entrega como para una reentrega tras una observación — no hay dos nombres distintos para lo mismo. |
| `observado` | Observado | El supervisor encontró un problema y lo devolvió con motivo obligatorio. |
| `entregado` | Entregado / Entregado fuera de fecha | Terminal. El supervisor aprobó. El sufijo "fuera de fecha" es un **label calculado**, no un valor de estado separado — ver §5. |

Se eliminan como valores de estado: `en_elaboracion` (no hace falta — el registro se guarda/entrega de
una, no hay un paso de borrador separado), `aprobado`/`presentado`/`cerrado` (se funden en `entregado`
+ el label calculado de puntualidad).

`SinPlanilla` (solo PDT601) y `Suspendida` (los dos módulos) **no son parte de este enum** — siguen
siendo booleanos en sus tablas de planilla/registro, tratados como flags independientes (§6).

## 4. Diagrama de transiciones

```
Pendiente
   │  Guardar con fecha de entrega cargada (acción implícita, no hay botón nuevo)
   ▼
Por revisar  ◄──────────────────────────────────────────────┐
   │                                                          │  Guardar tras corregir
   ├── Aprobar ──► Entregado / Entregado fuera de fecha       │  (acción implícita)
   │                     │                                    │
   │                     └── Reabrir (permiso especial,        │
   │                          motivo obligatorio) ─────────────┘
   └── Observar (motivo obligatorio) ──► Observado ────────────┘
```

Si se marca `Suspendida` o `SinPlanilla` en cualquier momento, el flujo de arriba queda congelado (no
se puede entregar/aprobar/observar mientras estén activos). Al desmarcarlos, el estado vuelve a
**Pendiente** — no se retoma un `Por revisar`/`Entregado` previo, porque durante la suspensión no hubo
ningún registro real que revisar.

## 5. Regla de "a tiempo" / "fuera de fecha"

- Se compara **únicamente** la fecha de entrega del asistente (`FechaEntrega` en PDT601,
  `PrimeraEntregaFecha` en PDT621) contra la fecha límite del **calendario interno de actividades del
  estudio** (`/settings/activity-configuration`, la misma regla que ya usa hoy el campo `Timeliness` /
  `AssistantTimeliness`).
- El cronograma oficial de SUNAT (usado hoy solo en PDT621 para `DeclarationTimeliness`, comparando
  contra `FechaDeclaracion`) **no participa en esta decisión** — queda como dato informativo aparte, tal
  como está hoy, sin ningún rol en el cálculo de a tiempo/fuera de fecha del nuevo estado `entregado`.
  Confirmado explícitamente: "esto no tiene nada que ver con el calendario de SUNAT, eso es solo
  informativo".
- El cálculo se hace en el momento de **Aprobar** (compara la fecha de entrega ya guardada contra el
  due date del período) y determina si el resultado queda como "Entregado" o "Entregado fuera de
  fecha". Como ambas fechas son fijas una vez que existen, no hace falta recalcular después — el label
  es estable.

## 6. `Suspendida` / `SinPlanilla` — flags independientes, no estados

- Siguen siendo booleanos en `supervisor_pdt601_planillas`/`supervisor_pdt621_records`, tal como hoy.
  **No se tocan los campos ni la lógica de backend que los limpia/bloquea** — ya está correctamente
  implementada y simétrica entre los dos módulos (verificado campo por campo).
- Para visualización (listado y export Excel) se mantiene exactamente el criterio de prioridad que ya
  existe hoy en el código — **no hay que agregarlo, ya funciona así en los dos módulos**:
  `Suspendida > SinPlanilla (solo PDT601) > estado real (Pendiente/Por revisar/Observado/Entregado)`.
- Lo que sí hay que ordenar es el **frontend de PDT621**: hoy el ocultamiento de campos cuando
  `Suspendida = true` está repartido en 4 condicionales sueltas (`Pdt621DetailPage.tsx`: panel de
  revisión, campos de 1ra/2da entrega, el `disabled` suelto de "Observación", y el bloque de
  importes/comprobantes/SIRE). PDT601 ya lo hace bien con una sola puerta
  (`{!planilla.sin_planilla && !planilla.suspendida ? (...) : null}`). Se debe unificar PDT621 al mismo
  patrón de una sola condición.

## 7. Reapertura ("Reabrir")

- Nueva acción, disponible solo con un permiso dedicado y distinto de
  `supervisors.declarations_update`/`_approve`/`_observe` — ej. `supervisors.declarations_reopen`,
  otorgado únicamente a un rol como Super usuario (mismo criterio que ya se usó para
  `payments.view_voided`).
- Exige motivo obligatorio. Se registra `ReopenedAt` / `ReopenedBy` / `ReopenReason` en la declaración
  (mismo patrón ya usado en este sistema para `Payment.VoidedAt/VoidedBy/VoidReason` y
  `Document.WriteoffAt/WriteoffBy/WriteoffReason` — no se inventa un mecanismo nuevo, se replica el que
  ya existe).
- Solo aplica desde `Entregado`. Vuelve a `Por revisar` (no a `Observado`) — el supervisor decide desde
  ahí si corrige él mismo y reaprueba, o si observa para que el asistente lo corrija.

## 8. Bloqueo de edición — extendido a los dos roles

Cambio real de comportamiento respecto a hoy:

- **Hoy**: PDT601 bloquea la edición del formulario **solo para el asistente** una vez aprobado
  (`assistantLocked`); el supervisor puede seguir editando siempre, incluso algo "Cerrado". PDT621 no
  bloquea a nadie, nunca, sin importar el estado.
- **Con el nuevo diseño**: al llegar a `Entregado`, el formulario queda bloqueado para **ambos roles**,
  en **los dos módulos** — nadie edita nada salvo a través de "Reabrir". Esto es necesario porque
  ahora `Entregado` es terminal de verdad ("ahí queda todo"), no un estado más que el supervisor puede
  seguir corrigiendo libremente como hoy.

## 9. Tabla de acciones por rol (versión final)

| Acción | Quién | Precondición | Resultado |
|---|---|---|---|
| Guardar/entregar registro | Asistente o Supervisor | Fecha de entrega cargada; estado actual Pendiente u Observado | → `Por revisar` (automático, sin selector manual) |
| Aprobar | Supervisor (`supervisors.declarations_approve`) | Estado = `Por revisar` | → `Entregado` o `Entregado fuera de fecha` (calculado) |
| Observar | Supervisor (`supervisors.declarations_observe`) | Estado = `Por revisar`; motivo obligatorio | → `Observado` |
| Reabrir | Permiso especial (`supervisors.declarations_reopen`) | Estado = `Entregado`; motivo obligatorio | → `Por revisar`, queda auditado |
| Marcar Suspendida / Sin planilla | Asistente o Supervisor | — | Flag aparte; congela el flujo de arriba; server-side limpia el resto de los campos |
| Editar datos del registro | Asistente o Supervisor | Estado ≠ `Entregado` | Libre mientras no esté bloqueado |

No queda ningún "Cambiar estado" de selección libre en ninguna de las dos pantallas — cada cambio de
estado es efecto de una acción real, no un campo de texto disfrazado de dropdown.

## 10. Plan de implementación (checklist, alto nivel — el detalle técnico exacto se define al codear cada paso)

### Backend

- [x] `backend/models/supervisor.go`: constantes nuevas para el enum reducido (`pdt_601`/`pdt_621`
      únicamente) — `SupervisorDeclPorRevisar`/`SupervisorDeclEntregado` son valores de columna propios
      (no alias de los viejos, para no mezclar significados con SIRE/Renta Anual/etc.), más
      `PDT601PDT621ValidStatuses`. Filas existentes de pdt_601/pdt_621 con los 7 valores viejos quedan
      pendientes de un backfill de datos (no bloqueante: solo importa para declaraciones nuevas o para
      cuando alguien vuelva a guardar una vieja).
- [x] `SupervisorDeclaration`: campos `ReopenedAt`/`ReopenedBy`/`ReopenReason` + relación `ReopenedByUser`.
- [x] RBAC: permiso `supervisors.declarations_reopen`, solo Super usuario (mismo criterio que `PaymentsViewVoided`).
- [x] `UpdateDeclaration`: el PUT genérico ya no acepta ningún cambio de estado para `pdt_601`/`pdt_621`
      (mismo patrón que Detracciones) — sí sigue permitiendo tocar otros campos (notas, prioridad, etc.).
- [x] `ApproveDeclaration`/`ObserveDeclaration` bifurcan a `approvePdt601Pdt621Declaration`/
      `observePdt601Pdt621Declaration` (precondición `Por revisar`, motivo obligatorio en Observar).
      Nuevo `ReopenDeclaration` + endpoint `POST /supervisors/declarations/:id/reopen`.
- [x] `SavePdt601Planilla`/`SavePdt621Record`: bloquean el guardado si el estado ya es `Entregado`, y
      mueven automáticamente Pendiente/Observado → Por revisar cuando queda una fecha de entrega
      cargada — todo en una transacción junto con el guardado de la planilla/registro.
- [x] Cálculo de puntualidad ("Entregado" vs "Entregado fuera de fecha"): confirmado — no se calcula ni
      se guarda nada al aprobar; reutiliza el `Timeliness`/`AssistantTimeliness` que ya existe (calculado
      en lectura contra el calendario interno). Se agregó `Timeliness` a `Pdt601Detail` y
      `AssistantTimeliness` a `Pdt621Detail` (antes solo estaban en la lista, no en el detalle) — el
      mapeo final a label ("Entregado fuera de fecha" si `timeliness == "late"", si no "Entregado")
      queda pendiente en el frontend (§14, Pdt601Config/Pdt621Config).
- [x] `pdt601PeriodDueDate(periodYM)`/`pdt621PeriodDueDate(periodYM)`: fecha límite única por período
      (calendario interno, nunca el cronograma SUNAT), reutilizada por los filtros nuevos.
- [x] `pdt601FilteredCompaniesQuery`/`pdt621FilteredCompaniesQuery`: pseudo-filtros
      `entregado_a_tiempo`/`entregado_fuera_de_fecha` (SQL, sin restructurar paginación — "entregado" a
      secas ya funcionaba solo, es un valor real del enum). Sin calendario configurado, "a tiempo"
      incluye todo lo entregado y "fuera de fecha" no devuelve nada — no se castiga por falta de
      configuración.
- [x] `PdtDashboardSummary`: `EntregadoATiempo`/`EntregadoFueraDeFecha` agregados a `PdtTypeSummary`
      (§12.1). De paso: la lógica de buckets se extrajo a `pdtBucketsSelectSQL` (reutilizada también
      por `PdtAssistantPerformance` abajo, para no duplicar ~40 líneas de SQL), y se reemplazó
      `CURDATE()` por una fecha literal calculada en Go — `CURDATE()` es MySQL-específico y no existe
      en sqlite, así que esta función **nunca había tenido ningún test** hasta ahora; con el cambio
      quedó testeable y se le agregaron los primeros tests.
- [x] Ninguno — el scope por rol ya funciona correctamente vía `GetAllowedCompanyIDs`, sin cambios de
      backend (confirmado en §12.2).
- [x] `PdtAssistantPerformance` (nuevo): una fila por (asistente, tipo de declaración), mismos buckets
      que `PdtDashboardSummary`, JOIN a `companies.assistant_user_id` + `users` para el nombre. Empresas
      sin asistente asignado no generan fila. Nuevo endpoint
      `GET /supervisors/dashboard/pdt-assistant-performance` (§12.3).

### Frontend

- [x] `Pdt601DetailPage.tsx` / `Pdt621DetailPage.tsx`: select "Cambiar estado" eliminado en los dos;
      "Estado" es un badge de solo lectura calculado (`pdt601DisplayStatus`/`pdt621DisplayStatus`,
      prioridad Suspendida > SinPlanilla > Entregado±puntualidad > estado real).
- [x] Botón "Reabrir" agregado en los dos detalles (visible solo con `supervisorsDeclarationsReopen`),
      con textarea de motivo obligatorio, dentro del panel "Revisión supervisor".
- [x] `assistantLocked` → `declarationLocked` en los dos módulos, sin condicionar por `workspace` —
      aplica a ambos roles cuando el estado es `entregado`. Los checkboxes Suspendida/Sin planilla
      (antes solo confirmación visual para el asistente en PDT601) pasan a ser el mismo control real
      para los dos roles.
- [x] `Pdt621DetailPage.tsx`: unificadas en una sola puerta (antes 4 condicionales sueltas +
      el select de estado, ya eliminado) — entregas, importes/comprobantes/SIRE bajo un mismo
      `{record.suspendida ? ... : ...}`.
- [x] `pdt601Config.ts` / `pdt621Config.ts`: `_STATUSES` al enum de 4 valores,
      `PDT601_TERMINAL_STATUSES`/`PDT621_TERMINAL_STATUSES` (renombrados desde `_APPROVED_STATUSES`),
      y nuevo `pdt601DisplayStatus`/`pdt621DisplayStatus` — fuente única del label+badge combinado,
      reemplaza el patrón `suspendida ? 'suspendida' : sinPlanilla ? ... : status` que estaba
      duplicado en detalle/listado/Excel/dashboard.
- [x] Listado y Excel (los dos módulos) adaptados a `pdt601DisplayStatus`/`pdt621DisplayStatus` — la
      sustitución Suspendida/SinPlanilla ya existente se mantiene intacta, solo cambia la fuente.
- [x] `PDT601_STATUS_FILTER`/`PDT621_STATUS_FILTER`: opciones al enum nuevo +
      `entregado_a_tiempo`/`entregado_fuera_de_fecha` (`entregado` a secas ya funcionaba solo, es un
      valor real del enum — no hizo falta agregarlo aparte).
- [x] `PdtTypeCard` (`SupervisorDashboard.tsx`): desglose a-tiempo/fuera-de-fecha dentro de
      "Completadas", mostrado solo cuando hay algo que desglosar (mismo criterio que Sin
      planilla/Suspendida ya existente).
- [x] Nueva tabla "Desempeño por asistente" (`PdtAssistantPerformanceTable`) en
      `SupervisorDashboard.tsx` — una fila por (asistente, tipo), visible solo cuando
      `workspace === 'supervisor'`.
- [x] Nueva ruta `assistant/dashboard` + página `AssistantDashboard.tsx`, reutilizando
      `PdtSummarySection` (exportado desde `SupervisorDashboard.tsx`) con `workspace="assistant"`,
      mismo endpoint — sin mandar ningún parámetro de rol, el backend ya escopea solo.
- [x] Bug real encontrado y corregido de paso: `pdtClientAggregation.ts` (usado por
      `AssistantWorkspace.tsx` para la tabla "declaraciones que requieren acción", no solo el resumen
      muerto que se iba a reemplazar) tenía hardcodeados los 7 valores viejos del enum — sin el fix,
      una declaración "entregado" hubiera podido aparecer marcada como "vencida, requiere acción" por
      error. Se agregaron `por_revisar`/`entregado` a sus sets de clasificación, y a
      `declarationStatusLabel` (label genérico compartido por otros tipos de declaración).
- [x] `AssistantWorkspace.tsx`: se optó por enlazar a la nueva ruta de dashboard (opción explícitamente
      permitida) en vez de embeber `PdtSummarySection` ahí mismo. **`pdtClientAggregation.ts` NO se
      retira** — al investigar se confirmó que, además del resumen por tipo (ese sí muerto, nunca
      renderizado), el archivo también alimenta la tabla "PDT 601 y PDT 621 — pendientes u observadas"
      de esa misma pantalla (`actionRows`), que sí está en uso real. Retirarlo hubiera roto esa tabla.

## 11. Filtro unificado en listados (PDT601 y PDT621)

**Punto de partida importante: esto ya existe hoy, en gran parte.** Los dos listados
(`Pdt601ListPage.tsx`, `Pdt621ListPage.tsx`) ya tienen un único select "Estado" que manda un solo
parámetro `status` al backend, y ese filtro **ya incluye** `sin_planilla` (solo PDT601) y `suspendida`
(los dos) como opciones junto a los estados reales — resueltos 100% en SQL vía subconsultas `EXISTS`
contra las columnas booleanas (`pdt601FilteredCompaniesQuery`/`pdt621FilteredCompaniesQuery`,
`backend/services/supervisor_pdt601_service.go` / `supervisor_pdt621_service.go`). No hay que inventar
el mecanismo de "un solo select con estados + flags mezclados" — ya está. Lo que hay que hacer es:

1. Actualizar las opciones al nuevo enum de 4 valores (`pendiente`, `por_revisar`, `observado`,
   `entregado`) en lugar de los 7 viejos.
2. Agregar dos opciones nuevas, pseudo-filtro (nunca se guardan así, se resuelven en la consulta):
   `entregado_a_tiempo` y `entregado_fuera_de_fecha` — para poder ver por separado, tal como se pidió,
   "los entregados" (`entregado`, sin distinguir) o específicamente "los entregados fuera de tiempo".

**Opciones finales del select "Estado" (mismo criterio en los dos módulos):**

| Valor | Label | PDT601 | PDT621 |
|---|---|---|---|
| `''` | Todos | ✅ | ✅ |
| `sin_registro` | Sin registro | ✅ (ya existe) | ✅ (ya existe) |
| `pendiente` | Pendiente | ✅ | ✅ |
| `por_revisar` | Por revisar | ✅ | ✅ |
| `observado` | Observado | ✅ | ✅ |
| `entregado` | Entregado (todos) | ✅ nuevo | ✅ nuevo |
| `entregado_a_tiempo` | Entregado a tiempo | ✅ nuevo | ✅ nuevo |
| `entregado_fuera_de_fecha` | Entregado fuera de fecha | ✅ nuevo | ✅ nuevo |
| `sin_planilla` | Sin planilla | ✅ (ya existe) | — (no aplica) |
| `suspendida` | Suspendida | ✅ (ya existe) | ✅ (ya existe) |

**Cómo se resuelve `entregado_a_tiempo`/`entregado_fuera_de_fecha` en SQL sin restructurar todo** —
esto era la parte técnicamente delicada, ya la investigué a fondo:

- Hoy, `Timeliness`/`AssistantTimeliness` se calculan en Go, **después** de la paginación SQL (la
  consulta pagina primero con `LIMIT`/`OFFSET`, y recién sobre esas filas ya traídas se calcula la
  puntualidad, fila por fila) — si tuviera que ser así para filtrar, habría que traer todo sin paginar,
  calcular en Go, filtrar, y recién ahí paginar en memoria. Eso sí sería una restructuración grande.
- **Pero no hace falta**, porque la fecha límite del calendario interno **es una sola por período**,
  igual para todas las empresas (`findPdt601CalendarActivity(periodYM)`/`findPdt621CalendarActivity`
  ya hacen "una sola consulta, no por empresa" — está comentado así en el código). Al ser un solo valor
  fijo por período, se puede calcular **una vez**, antes de armar la consulta, y usarlo como una
  comparación SQL directa: `WHERE d.status = 'entregado' AND pl.fecha_entrega <= ?` (a tiempo) o
  `> ?` (fuera de fecha) — sin tocar el orden de paginación ni el cálculo por fila que ya existe para
  otras cosas.
- Conviene extraer esa fecha límite a una función reutilizable (ej. `pdt601PeriodDueDate(periodYM)`),
  usada tanto por el filtro nuevo como por el cálculo de `Timeliness` que ya existe — para no calcular
  la misma fecha límite dos veces con lógica duplicada.
- Importante: el cronograma oficial de SUNAT (`pdt621ScheduleDueDate`, usado hoy solo por
  `DeclarationTimeliness` en PDT621) **sí varía por empresa** (según el dígito de RUC) — pero, como ya
  quedó definido en §5, ese cronograma no participa en absoluto en esta regla. Solo se usa el
  calendario interno, que es el que permite este atajo de "una sola fecha por período".

## 12. Dashboards (Supervisor y Asistente)

Acá encontré algo importante al revisar el código: **el dashboard del supervisor y el "dashboard" del
asistente hoy NO comparten la misma lógica** — son dos implementaciones distintas, con distinta
calidad, no dos vistas del mismo dato.

### 12.1 — Dashboard del supervisor: ya está bien diseñado, solo hay que sumarle el dato nuevo

`SupervisorDashboard.tsx` consume `GET /supervisors/dashboard/pdt-summary` →
`SupervisorService.PdtDashboardSummary` (`backend/services/supervisor_service.go`). Esta función
**ya prioriza correctamente Suspendida/SinPlanilla por sobre el estado real** — una empresa exenta
(sin planilla o suspendida) queda en su propio conteo aparte y se excluye explícitamente (`NOT
isExempt`) de Pendientes/Observadas/Vencidas/Completadas, así nunca aparece como "pendiente" por
error. Esto es exactamente el criterio que ya definimos en §6 — no hay que rediseñar esta parte, **solo
extenderla**: agregar dos conteos nuevos (`EntregadoATiempo`/`EntregadoFueraDeFecha`) al struct
`PdtTypeSummary`, calculados con el mismo truco SQL de la fecha límite única por período (§11), y
mostrar esa apertura en las tarjetas (`PdtTypeCard`) igual que hoy se muestran "Sin planilla"/
"Suspendida" como mini-estadísticas condicionales cuando su conteo es mayor a 0.

### 12.2 — "Dashboard" del asistente: está en un camino totalmente distinto, y ese camino tiene un bug real hoy

`AssistantWorkspace.tsx` (Panel del asistente) **no llama al mismo endpoint que el supervisor**. Usa
`frontend/src/utils/pdtClientAggregation.ts`, una utilidad más vieja que:

- Hace N+1 consultas (una por cada control mensual) en vez de una sola consulta agregada — el propio
  comentario en `supervisor_service.go` dice que `PdtDashboardSummary` fue creado para **reemplazar**
  este patrón.
- Clasifica cada declaración **solo por `status`**, sin mirar para nada `sin_planilla`/`suspendida` —
  es decir, tiene exactamente el bug que pediste evitar: una empresa suspendida o sin planilla hoy
  puede contarse como "pendiente" (y eventualmente "vencida") en esta ruta, al revés de lo que ya hace
  bien el dashboard del supervisor.
- Hoy este bug no se nota en pantalla porque, casualidad, `AssistantWorkspace.tsx` ni siquiera
  renderiza ese resultado por tipo de actividad (sus 4 tarjetas KPI se calculan de otra fuente, el
  estado general del control mensual, no por PDT601/621 puntualmente) — pero el dato mal calculado
  existe y quedaría expuesto en cuanto alguien lo conecte a la pantalla.

**Propuesta**: en vez de corregir la lógica vieja (`pdtClientAggregation.ts`) para que también entienda
Suspendida/SinPlanilla/Entregado-fuera-de-fecha —duplicando criterio con el backend—, conviene
**jubilar ese archivo** y hacer que `AssistantWorkspace.tsx` llame al mismo
`PdtDashboardSummary`/`PdtSummarySection` que ya usa el supervisor (el componente `PdtSummarySection`
ya está preparado para un `workspace="assistant"`, hoy simplemente nadie lo invoca así). Esto evita
mantener dos veces la misma regla de negocio en dos lugares que ya demostraron poder divergir.

**Ya lo confirmé — el scope ya funciona bien para los dos roles, sin tocar nada del backend:**

- `Company` tiene dos columnas independientes: `SupervisorUserID` y `AssistantUserID` (un supervisor y
  un asistente por empresa, cada uno asignado por separado).
- `AccessService.GetAllowedCompanyIDs(userID)` (`backend/services/access_service.go`) es la única
  función que resuelve "qué empresas puede ver este usuario", y es **agnóstica de rol**: devuelve toda
  empresa donde `accountant_user_id = userID OR supervisor_user_id = userID OR assistant_user_id =
  userID`, más lo que tenga por asignación manual extra (`CompanyAssignment`). Esto significa que, sin
  ningún cambio, **un supervisor ya ve automáticamente todas las empresas donde figura como supervisor
  — sin importar cuál de sus asistentes esté asignado a cada una —, y un asistente ya ve únicamente las
  empresas donde él mismo es el asistente directo.** Exactamente el comportamiento que pediste.
- `PdtDashboardSummary` no tiene ninguna lógica propia de scope — solo consume la lista de IDs que ya le
  llega resuelta. No hay nada que "arreglar" ahí para que distinga supervisor de asistente.
- El permiso ya está: el rol Asistente ya tiene `SupervisorsDashboardView` en su set de permisos
  (`backend/rbac/registry.go`) — puede llamar al endpoint hoy mismo, a nivel de permisos.
- Ya existe un precedente exacto de esta misma separación por ruta sin tocar el backend: la pantalla
  "Empresas asignadas" (`AssignedCompaniesListPage.tsx`) usa un único componente con prop
  `workspace`, pega al mismo endpoint sin mandar ningún parámetro de rol, y el backend ya devuelve lo
  correcto para cada uno gracias a `GetAllowedCompanyIDs`.

**Lo único que realmente falta es la ruta del lado del asistente — no existe ninguna hoy.** Hoy
`/supervisors/dashboard` (frontend) solo tiene wrapper para supervisor
(`SupervisorDashboard.tsx`); no hay un `assistant/dashboard` en `App.tsx`, ni un backend `/assistant/...`
aparte (todo pasa por `/api/supervisors/*`, filtrado por permiso, no por una familia de rutas separada).
La solución es mecánica y de bajo riesgo: agregar la ruta `assistant/dashboard` + un wrapper
`AssistantDashboard` que renderice el mismo componente con `workspace="assistant"` — el mismo patrón
uno-a-uno que ya usan `SupervisorPdt601ListPage`/`AssistantPdt601ListPage` hoy para PDT601/621.

**Nota ya cerrada** (se evaluó y se descartó un modelo de jerarquía asistente→supervisor —
`docs/diseno-jerarquia-asistente-supervisor-2026-09-16.md`): se confirmó con el estudio que la
supervisión se define por empresa/cliente, no por persona — es normal que un mismo asistente reporte a
distintos supervisores según la empresa. `Company.SupervisorUserID`/`AssistantUserID` son la fuente de
verdad correcta tal cual están, sin necesidad de ningún dato adicional.

### 12.3 — Desempeño por asistente, dentro del dashboard del supervisor (nuevo, no existe hoy)

Esto es lo que le falta al dashboard del supervisor para responder "¿cómo viene cada uno de mis
asistentes?", no solo el total agregado de todo el portafolio:

**Qué ya existe y se reutiliza tal cual:**
- El filtro "Asistente" de los listados (`Pdt601ListPage.tsx`/`Pdt621ListPage.tsx`) ya existe, ya
  funciona, y ya está bien scopeado: la lista de asistentes que ofrece (`GET
  /finance/company-credentials/filter-facets`) sale de las empresas del propio supervisor
  (`GetAllowedCompanyIDs`), no de todo el estudio. Con esto, un supervisor **ya puede hoy** filtrar el
  listado por un asistente puntual y ver, empresa por empresa, cómo le está yendo — fila por fila, no
  como resumen numérico.

**Qué falta — un resumen agregado, no una lista filtrada:**
- `PdtDashboardSummary` hoy agrupa **solo por tipo de declaración** (`GROUP BY
  declaration_type`) — un total para PDT601, un total para PDT621, sin desglose por persona. No hay en
  ningún lado del código una tabla "una fila por asistente, con sus conteos" para PDT601/621
  específicamente (sí existe algo parecido pero distinto: `ReportProductivity`/`SupervisorService`
  agrupa controles mensuales por `responsible_user_id`, mezclando todos los tipos de declaración
  juntos, no por el asistente asignado a la empresa ni separado por PDT601/621 — sirve como plantilla
  de "tabla tipo ranking por persona", no como algo reutilizable tal cual).
- **Diseño propuesto**: una nueva consulta agregada (mismo criterio de buckets que ya usa
  `PdtDashboardSummary` — Suspendida/SinPlanilla excluidos de los conteos operativos, ahora sumando
  Entregado a tiempo/fuera de fecha de §12.1), pero agregando `companies.assistant_user_id` al `JOIN`
  y al `GROUP BY`, acotada siempre a `AllowedCompanyIDs` del supervisor que está mirando su propio
  dashboard (nunca estudio-wide desde acá). Resultado, una fila por asistente:

  | Asistente | Pendiente | Por revisar | Observado | Entregado a tiempo | Entregado fuera de fecha | Sin planilla | Suspendida | Total empresas |
  |---|---|---|---|---|---|---|---|---|

- Se calcula por separado para PDT601 y PDT621 (dos tablas, o una con selector de módulo — de acuerdo a
  como se vea mejor en pantalla, es un detalle de UI a definir al implementar, no cambia el diseño de
  la consulta).
- Este nuevo desglose vive **solo en el dashboard del supervisor** (tiene sentido ahí: es él quien
  necesita comparar a sus asistentes entre sí). El dashboard del asistente (§12.2) no lo necesita — ahí
  solo hay una persona, así que el resumen agregado ya es, de hecho, "su" desempeño.

## 13. Decisiones de diseño ya cerradas (para no reabrir la discusión)

1. "Por revisar" es un único estado tanto para la primera entrega como para una reentrega tras
   observación — no se crean dos nombres para la misma situación operativa.
2. "Entregado" es terminal, pero con excepción: se puede reabrir con permiso especial y motivo
   obligatorio (no queda absolutamente cerrado sin salida).
3. La puntualidad (a tiempo / fuera de fecha) se calcula **solo** contra el calendario interno del
   estudio — el cronograma de SUNAT es puramente informativo, sin ningún rol en el estado.
4. El bloqueo de edición en "Entregado" aplica a **ambos roles** (asistente y supervisor), no solo al
   asistente como hoy en PDT601.
5. Al desmarcar Suspendida/SinPlanilla, el estado vuelve a Pendiente (no se retoma un estado previo).
6. Detracciones, SIRE, Renta Anual y Buzón SOL quedan completamente fuera de este rediseño — comparten
   la columna física pero no el nuevo enum reducido ni sus reglas de transición.
7. El filtro unificado por estado (incluyendo Sin planilla/Suspendida) en los listados **ya existe**
   como mecanismo — solo se actualizan sus opciones al nuevo enum y se suman
   `entregado_a_tiempo`/`entregado_fuera_de_fecha`, resueltos con una fecha límite única por período
   (no por empresa), sin restructurar el orden de paginación actual.
8. El dashboard del supervisor mantiene su arquitectura actual (ya es correcta), solo se le agregan los
   dos conteos nuevos de puntualidad. El "dashboard" del asistente se migra a usar ese mismo endpoint
   en vez de su agregación cliente-side actual, que hoy no entiende Suspendida/SinPlanilla (ver §12.2).
9. El scope por rol (supervisor ve todas las empresas donde figura como supervisor, sin importar el
   asistente; el asistente ve solo sus propias empresas asignadas) **ya funciona correctamente hoy** vía
   `AccessService.GetAllowedCompanyIDs`, sin ninguna lógica especial por rol — no requiere cambios de
   backend. Falta únicamente la ruta/wrapper del frontend para el dashboard del asistente, que hoy no
   existe (§12.2).
10. ~~Prerrequisito de jerarquía asistente→supervisor~~ — **descartado, sin efecto en este documento.**
    Se evaluó agregar un supervisor fijo por asistente (`docs/diseno-jerarquia-asistente-supervisor-
    2026-09-16.md`), pero se confirmó con el estudio que la supervisión se define **por empresa/
    cliente**, no por persona: es normal que un mismo asistente reporte a distintos supervisores según
    la empresa. Ese documento queda registrado como descartado, con el porqué. **No hay ningún
    prerrequisito pendiente** — el reporte de desempeño de §12 se arma directamente agrupando por
    `Company.SupervisorUserID` (para evaluar a un supervisor, sin importar el asistente) y por
    `Company.AssistantUserID` (para evaluar a un asistente, sin importar el supervisor) — el dato que
    ya existe hoy es correcto y suficiente, sin cambios de modelo.
