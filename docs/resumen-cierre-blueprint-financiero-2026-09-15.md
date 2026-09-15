# Resumen de cierre — Blueprint Financiero Definitivo

**Fecha de cierre**: 2026-09-15
**Referencia**: `docs/blueprint-financiero-definitivo-2026-09-14.md`
**Estado**: las 7 fases quedaron implementadas, auditadas, testeadas y publicadas en `main`
(push confirmado, `origin/main` = `cd9b697`).

Este documento consolida en un solo lugar qué se hizo en cada fase, por qué, y dónde encontrar el
detalle técnico completo (cada fase tiene su propia auditoría/diseño/implementación documentada por
separado en esta misma carpeta — este resumen es el mapa de todo eso).

---

## Índice de commits

| Fase | Commit | Mensaje |
|---|---|---|
| 1 | `838b990` | fix(debt): Fase 1 del blueprint financiero — integridad de deuda arrastrada |
| 2.1-2.2 | `2538097` | Fase 2.1-2.2: add payment purpose and historical backfill |
| 2.3 | `9fa3eb9` | Fase 2.3: support payment overpayments with unapplied remainder |
| 2.4 | `df6f0b2` | feat(finance): implement existing payment allocation |
| 2.5 | `894918e` | feat(finance): add payment concurrency locking |
| 3 | `44b0950` | feat(finance): centralize financial balance calculations |
| 4-5 | `b196561` | feat(finance): Fase 4-5 — Payment+comprobante atomico y POS con idempotencia |
| 6 | `93dd7f2` | feat(finance): implement payment voiding and write-off controls |
| 7 | `cd9b697` | feat(finance): complete financial UI and audit reporting |

---

## Fase 1 — Integridad de deuda arrastrada

**Problema encontrado**: al eliminar un `Document` (deuda), si ese documento había sido "arrastrado"
de una liquidación anterior a otra, se perdía el rastro de cuál liquidación lo originó realmente —
podía llevar a inconsistencias al reconstruir el historial de una empresa.

**Solución**: se agregó `Document.OriginSettlementID` (inmutable, se fija una sola vez al crear el
documento) como fuente de verdad de "quién originó esta deuda", separado de `TaxSettlementID`
(mutable, la liquidación *actual*).

**Commit**: `838b990`.

---

## Fase 2 — Payment.Purpose, sobrepagos y aplicación de pagos existentes

Cuatro pasos, cada uno auditado antes de implementarse:

- **2.1-2.2** (`2538097`): se agregó `Payment.Purpose` (`deuda` / `servicio` / sin clasificar) — el
  concepto que distingue "este dinero es para pagar una cuenta por cobrar" de "este dinero es un
  ingreso independiente (servicio)". Incluye backfill de datos históricos con evidencia (nunca
  inventado).
- **2.3** (`9fa3eb9`): se permitió que un pago exceda el monto exacto de la deuda, dejando el
  remanente sin aplicar (en vez de rechazar el pago o forzar un ajuste artificial).
- **2.4** (`df6f0b2`): nueva función `AllocateExisting` — permite aplicar el remanente de un `Payment`
  ya existente a una o más deudas, sin crear un pago nuevo.
- **2.5** (`894918e`): se resolvió una condición de carrera real (reproducible solo contra MySQL, no
  en tests con sqlite) donde dos operaciones concurrentes sobre el mismo pago/deuda podían pisarse.
  Se introdujo el mecanismo de locking (`FOR UPDATE`, orden Payment→Documents ascendente) que después
  reutilizaron todas las fases siguientes.

---

## Fase 3 — Centralización de los cálculos financieros

**Problema encontrado**: el saldo de una empresa se calculaba con la fórmula `deuda total − pagos
totales` en al menos 4 lugares distintos del sistema. Esa fórmula mezcla dinero de servicio/a cuenta
con deuda real, y puede dar saldos negativos falsos.

**Solución**: se crearon 4 funciones oficiales, únicas, en `backend/services/debt/financial_totals.go`:
`SaldoDocumentado`, `DineroTotalRecibido`, `DineroAplicadoADeudas`, `DineroNoAplicado`. Se migraron
Dashboard, Estado de Cuenta, Reporte Financiero y `GetCompanyBalance` para usarlas exclusivamente. El
Reporte de Deudas se auditó y se confirmó que ya estaba correcto (no necesitó cambios).

**Commit**: `44b0950`.

---

## Fase 4-5 — Comprobantes atómicos y ventas POS

**Fase 4**: se creó `CreatePaymentWithComprobante` — crea un `Payment` y su comprobante fiscal (Tukifac)
en una sola transacción, nunca dejando uno sin el otro.

**Fase 5**: se integró el flujo de venta POS con esa misma función (en vez de duplicar su lógica), y se
agregó protección contra ventas duplicadas por doble clic o reintento de red: cada venta POS puede
llevar una referencia única generada por el cliente (`SaleClientRef`); si la misma referencia llega dos
veces, la segunda devuelve la venta ya creada en lugar de duplicarla — protegido con un índice único en
base de datos como barrera real contra condiciones de carrera, no solo una verificación previa.

Auditado y documentado como pendiente (no implementado, por falta de información en el flujo actual):
el caso "el POS registra un pago que va destinado a saldar una deuda existente del cliente" —
requeriría que la pantalla de venta POS pueda indicar explícitamente qué deuda se está pagando.

**Commit**: `b196561`.

---

## Fase 6 — Anulación de pagos y bajas de deuda (write-off)

**Problema encontrado**: eliminar un pago lo hacía desaparecer sin dejar ningún rastro de quién lo
eliminó, cuándo, ni por qué. Además, era posible condonar/anular una deuda que todavía tenía dinero
real aplicado y saldo pendiente, sin ninguna advertencia.

**Solución**:
- Se agregaron `VoidedAt`/`VoidedBy`/`VoidReason` a `Payment` — anular un pago ahora queda auditado,
  revierte correctamente sus aplicaciones a deudas, recalcula los saldos afectados, y si el pago había
  vinculado una deuda a una liquidación, revierte ese vínculo (pero solo si ningún otro pago activo lo
  sigue sosteniendo).
- Se bloqueó `WriteOffUnlinkedDebt` (exonerar/anular una deuda) cuando esa deuda todavía tiene dinero
  real aplicado (vía imputación o pago legacy) y saldo pendiente — antes se permitía sin avisar.
- Se verificó exhaustivamente que dos anulaciones simultáneas del mismo pago nunca produzcan doble
  efecto (con tests de concurrencia reales).

**Commit**: `93dd7f2`.

---

## Fase 7 — Interfaz y reportes financieros

**Problema encontrado más importante** 🔴: el listado principal de empresas (`GET /api/companies`)
calculaba el saldo mostrado con la fórmula `deuda total − pagos totales` en SQL directo — exactamente
la fórmula que la Fase 3 ya había prohibido y reemplazado en todos los demás lugares, pero que se
había quedado sin migrar en este endpoint específico.

**Solución**:
- Se corrigió el listado de empresas para usar `SaldoDocumentado`, igual que el resto del sistema.
- Se identificaron y corrigieron ~5 sitios más donde distintos reportes calculaban "total de pagos"
  con fórmulas SQL propias en vez de la función oficial (sin impacto visible hoy, pero frágil a futuro).
- Se creó una vista nueva y separada, de solo lectura, para auditar pagos anulados
  (`/payments/voided`, permiso dedicado `PaymentsViewVoided`) — muestra monto, fechas, quién anuló,
  motivo, propósito y la deuda/liquidación relacionada. Nunca se mezcla con el listado de pagos activos.
- Se agregó visualización explícita del `Purpose` de cada pago (Deuda / Servicio / Sin clasificar),
  antes invisible en la interfaz.
- Se corrigió un bug de interfaz: una deuda exonerada se mostraba con la misma etiqueta verde
  "Pagado" que una deuda realmente cobrada — ahora tiene su propia etiqueta ("Exonerado") y muestra
  motivo, usuario y fecha de la baja.

**Commit**: `cd9b697`.

---

## Deuda técnica diferida (documentada, no bloqueante, no implementada a propósito)

Estos puntos se identificaron durante las auditorías pero se decidió explícitamente no resolverlos en
esta ronda de trabajo — quedan registrados para una futura fase si se decide abordarlos:

1. **POS pagando una deuda existente** (Fase 4-5): la pantalla de venta POS no tiene forma de indicar
   qué deuda específica se está pagando; falta ese dato antes de poder implementarlo.
2. **Caso límite de anulación sobre un pago histórico ya eliminado antes de Fase 6** (Fase 6): no
   causa ningún dato incorrecto (protegido por rollback), pero hace trabajo innecesario antes de
   fallar con un mensaje menos claro de lo ideal.
3. **Inconsistencia menor entre `VoidedBy` y `WriteoffBy`** (Fase 6): manejan distinto el caso de
   "sin usuario asociado" (`0`); sin impacto real porque ningún flujo actual llega a ese caso.
4. **Falta un test HTTP a nivel de controlador** para la respuesta 200 idempotente al reintentar
   anular un pago ya anulado (la lógica en sí está probada a nivel de servicio).
5. **Bug de una línea** en `services/debt/audit.go:211` — un filtro que no se aplica por un error de
   reasignación en Go. Solo afecta a `GET /api/reports/debts`, que hoy no tiene ninguna pantalla que
   lo consuma.
6. **Sin bloqueo para editar una deuda ya exonerada/anulada** — ni la interfaz ni el backend impiden
   hoy modificar una deuda que ya fue dada de baja. Es un gap real, originado en Fase 6, pendiente de
   decidir cómo cerrarlo.
7. **Sin resumen visible** de qué pagos quedaron anulados automáticamente al eliminar o revertir una
   liquidación completa — el aviso solo aparece antes de confirmar la acción, no después.
8. **Código defensivo sin uso activo** en el cálculo de saldo de una deuda en el frontend (un
   respaldo que recalcula localmente si el dato del servidor llegara vacío) — verificado que hoy nunca
   se activa, pero sigue presente.

---

## Verificación previa a la publicación

- Suite completa de tests backend: **267/267** en `services`, **23/23** en `controllers`/`database`.
- Regresión de Fases 4-6 re-ejecutada en Fase 7: **62/62**.
- Tests nuevos de Fase 7: **13/13**.
- `go build`, `go vet`: limpios (único aviso preexistente y no relacionado en una herramienta de
  línea de comandos interna, `cmd/debt-audit`).
- Frontend: `npm install`, `tsc --noEmit` y `npm run build` (`tsc && vite build`, el mismo comando que
  usaría un despliegue) — los tres sin errores.
- `git diff --check` limpio, sin archivos fuera del alcance aprobado en ninguna fase.

Publicado en `origin/main` el 2026-09-15, commit `cd9b697`.
