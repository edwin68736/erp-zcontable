# Requerimiento: Planes, categorías y facturación recurrente por empresa

**Versión:** borrador para discusión  
**Estado:** no implementado — solo especificación  
**Relación con el sistema actual:** se apoya en empresas (clientes), documentos como cargos y pagos como abonos; este documento define cómo parametrizar y generar esos cargos de forma recurrente y diferenciada por tipo de cliente/plan. Incluye además la **reorientación de la integración con Tukifac** respecto al orden causal entre pago interno y comprobante fiscal (§10).

---

## 1. Objetivo

Permitir al estudio contable:

- Definir **categorías de planes** (ej. clientes históricos vs nuevos, o cualquier segmento comercial).
- Dentro de cada categoría, definir **planes** con **precios y límites de facturación** configurables por tramos (monto mínimo/máximo de facturación del cliente y precio mensual asociado).
- Al **crear o asociar una empresa** a un plan, indicar si la **mensualidad se cobra al inicio o al final del mes**.
- **Generar automáticamente** los cargos mensuales del plan según la categoría/plan y el volumen de facturación del período (según reglas acordadas).
- Complementar con **cargos manuales** (trámites, constitución, etc.) que **acumulan deuda** con descripción, permitiendo **pagos totales o parciales** contra el saldo global o contra conceptos.

---

## 2. Alcance

**Incluye:**

- Maestro de categorías de planes y planes con tramos de precio por rango de facturación.
- Asignación de plan (y categoría implícita) a empresa; ciclo de facturación (inicio vs fin de mes).
- Generación periódica de deuda por concepto de mensualidad (con descripción que incluya el mes de servicio).
- Cargos adicionales manuales con descripción y acumulación en cuenta del cliente.
- Aplicación de pagos (parciales o totales), alineada con el modelo actual de pagos/documentos o con extensiones mínimas acordadas.

**Queda fuera de este borrador (salvo que se acuerde):**

- Integración con pasarelas de pago.
- Notificaciones automáticas (correo/WhatsApp) por vencimiento.

**Nota:** la **emisión fiscal vía Tukifac** queda **dentro del alcance conceptual** del §10 (como consecuencia del pago registrado en este sistema), no como sustituto del registro de pagos.

---

## 3. Definiciones

| Término | Significado |
|--------|-------------|
| **Categoría de plan** | Agrupador comercial/operativo (ej. “Legacy”, “Nuevos 2026”). No define precio por sí sola; agrupa planes. |
| **Plan** | Conjunto de reglas de cobro recurrente: uno o más **tramos** según facturación del cliente en el período. |
| **Tramo de facturación** | Rango `[monto_mín, monto_máximo]` de facturación (del cliente en el mes o período definido) y **precio fijo** del plan para ese tramo. |
| **Suscripción / asignación** | Vinculación empresa ↔ plan activo, con fecha de inicio, ciclo (inicio/fin de mes) y estado (activa/suspendida). |
| **Cargo recurrente** | Documento (o equivalente contable) generado automáticamente por el sistema por el plan del mes correspondiente. |
| **Cargo manual / ad hoc** | Servicio puntual (constitución, trámite) registrado como deuda adicional con descripción propia. |
| **Pago (sistema interno)** | Abono que reduce deuda del cliente; es la **fuente de verdad** del hecho de cobro para fines de cartera y saldo. |
| **Comprobante fiscal (Tukifac)** | Factura/boleta u otro comprobante SUNAT emitido por el estudio por el monto cobrado; **documenta fiscalmente** un pago ya reconocido (o en curso), no debe reemplazar al pago interno. |
| **Imputación** | Reparto del monto de un **pago** entre uno o varios **cargos** pendientes (cuánto se aplica a cada documento de deuda). |

---

## 4. Requisitos funcionales

### 4.1 Categorías de planes

- Crear, editar y desactivar categorías (código, nombre, descripción opcional, orden de visualización).
- Una categoría contiene **uno o más planes**.

### 4.2 Planes dentro de una categoría

- Crear, editar y desactivar planes bajo una categoría.
- Campos mínimos sugeridos: nombre, descripción opcional, vigencia (opcional), estado activo/inactivo.
- Cada plan define **uno o más tramos**:
  - `monto_facturacion_min` (inclusive o según regla acordada).
  - `monto_facturacion_max` (inclusive, o “sin tope” si se modela como NULL o valor especial).
  - `precio_mensual` (monto a cobrar si el cliente cae en ese tramo en el período de liquidación).
- Los tramos del mismo plan **no deben solaparse** (validación).
- Debe poder existir un tramo “residual” o regla explícita para clientes fuera de rangos (ej. error, precio por defecto o tramo “mayor a X”).

### 4.3 Base para calcular “facturación del período”

**Decisión de negocio pendiente (marcar en implementación):**

- Opción A: suma de montos de **comprobantes de venta del cliente** obtenidos vía Tukifac (facturación del cliente a *sus* clientes), **no** los comprobantes que el estudio emite al cliente por honorarios — esos últimos se tratan en el §10.
- Opción B: suma de **todos los documentos** de tipo “ventas” en el mes.
- Opción C: campo manual de “facturación declarada” por mes (menos automático).

El requerimiento exige que la opción elegida sea **configurable o documentada** por plan/categoría si hubiera excepciones.

### 4.4 Asignación a la empresa

- Al crear o editar empresa: seleccionar **plan activo** (y por tanto categoría).
- Indicar **ciclo de cobro**:
  - **Inicio de mes:** generar cargo el día 1 (o primer día hábil configurable) por el mes en curso o el siguiente según regla acordada.
  - **Fin de mes:** generar cargo al cierre del mes por el servicio del mes que termina (tras conocer la facturación del período si aplica).
- Fecha de inicio de la suscripción y, si aplica, fecha de fin o renovación automática.

### 4.5 Generación automática mensual de deuda (mensualidad)

- Job o proceso batch (diario/mensual) que:
  1. Liste empresas con suscripción activa y plan asignado.
  2. Para cada una, determine el **período de liquidación** y la **facturación base** según la regla del §4.3.
  3. Resuelva el **tramo** y el **monto** del cargo.
  4. Genere un **cargo** (documento o entidad equivalente) con:
     - Empresa, monto, fecha de emisión, concepto/descripción **estandarizada** (ej. `Mensualidad plan {nombre} — {YYYY-MM}`).
     - Tipo de origen: `recurrente_plan` (o similar) para distinguirlo de Tukifac y de cargos manuales.
- Evitar duplicados: un solo cargo de mensualidad por empresa y **mes-servicio** (clave única lógica).

### 4.6 Cargos manuales adicionales (trámites, constitución, etc.)

- Permitir registrar cargos con **descripción libre**, monto y fecha; no se exige cobro inmediato.
- Cada cargo incrementa la deuda del cliente de la misma forma que un documento actual.
- Opcional: categoría de concepto (constitución, asesoría puntual, etc.) para reportes.

### 4.7 Pagos e imputación a varias deudas (cartera con muchos conceptos)

Durante un mismo mes una empresa puede tener **varios cargos** independientes: por ejemplo mensualidad de plan (S/ 200), un trámite adicional, otro concepto, etc. Cada uno es una **línea de deuda** (documento/cargo pendiente). El **saldo** de la empresa es la suma de lo pendiente de esas líneas menos los pagos imputados.

#### 4.7.1 Relación con Tukifac (un comprobante, varias deudas)

Es habitual que en cartera existan **varias deudas abiertas** (p. ej. total pendiente S/ 1 000) pero en Tukifac el cliente tenga **una sola factura** por un monto menor (p. ej. S/ 100) que refleja lo que en esa operación se facturó/cobró. Ese comprobante, al conciliarse, origina un **único pago local** de S/ 100; el sistema debe permitir decidir **cómo** esos S/ 100 se reparten entre las deudas (**imputación**), sin asumir que la factura “pertenece” sola al cargo más antiguo salvo que el usuario elija el modo automático descrito abajo.

#### 4.7.2 Modo automático (por defecto sugerido): FIFO sobre deuda más antigua

- Al registrar o generar un pago (incluido el creado desde la bandeja Tukifac, §10.4.1), el usuario puede elegir **imputación automática**.
- Criterio: ordenar los cargos **pendientes** de la empresa por **antigüedad** (fecha de emisión del cargo, o fecha de vencimiento si se define así de forma única en el producto).
- Aplicar el monto del pago **secuencialmente**: primero al cargo más antiguo hasta **liquidarlo** o **agotar** el monto del pago; el remanente pasa al siguiente cargo, y así sucesivamente.
- **Ejemplo:** deudas A=200 (más antigua), B=300, C=500; pago de 100 → solo A queda con **saldo parcial** 100 pendiente; B y C intactos.
- **Ejemplo:** deuda D=100 y pago (factura) de 100 → D queda **liquidada** en su totalidad.
- **Ejemplo:** deuda E=100 y pago de 50 → E queda **parcialmente pagada** (50 pendiente en esa línea).

#### 4.7.3 Modo manual

- El usuario indica explícitamente **a qué cargo(s)** aplica el pago y **cuánto** a cada uno (suma de líneas de imputación = monto del pago, con validación).
- Sirve cuando el cobro en Tukifac corresponde **claramente** a un concepto concreto (p. ej. solo mensualidad) aunque existan otras deudas más antiguas.
- Si el monto imputado a un cargo es **igual** al pendiente de ese cargo, la línea queda **cerrada**; si es **menor**, queda **parcial**.

#### 4.7.4 Reglas transversales

- Un mismo **Payment** puede tener **varias líneas de imputación** (N cargos) cuando el modo automático reparte el monto o el usuario distribuye manualmente. *Implementación:* el modelo actual con un solo `document_id` por fila no basta; se usará **tabla de distribuciones** (pago → N filas documento/monto) **o** **N filas de pago** ligadas por un identificador de grupo y un único vínculo fiscal Tukifac; conviene fijar una opción en diseño técnico.
- **Pago “a cuenta”** (opcional, §4.7 histórico): monto registrado sin imputación inmediata; luego se distribuye en un segundo paso — solo si el negocio lo pide; si no, puede omitirse en la primera versión.
- Los pagos ligados al **plan recurrente** deben verse en estado de cuenta con la **descripción del mes** del cargo al que se imputaron (cuando aplique).
- En la **conciliación Tukifac**, tras crear el pago por el monto del comprobante, la UI debe ofrecer **imputación automática (FIFO)** o **manual** en el mismo flujo (o paso siguiente obligatorio antes de confirmar).

### 4.8 Límites de documentos (mencionado por el negocio)

- Si “límite de documentos” significa **tope de comprobantes emitidos/sincronizados** incluidos en el plan:
  - Definir en el plan: `limite_documentos_periodo` y periodicidad (mensual/anual).
  - Si se supera: solo alerta, cargo adicional automático o bloqueo — **a definir en una segunda iteración** del requerimiento.

---

## 5. Reglas de negocio (resumen)

1. El precio mensual del plan depende del **tramo** al que pertenezca la facturación del período, según tablas parametrizables del plan.
2. Clientes antiguos y nuevos se discriminan por **categoría de plan** y/o **plan asignado**, no por lógica fija en código.
3. El **mes de servicio** debe quedar explícito en la descripción del cargo recurrente.
4. No debe generarse dos veces la misma mensualidad para la misma empresa y mismo mes-servicio.
5. Cargos manuales y recurrentes coexisten en el mismo estado de cuenta; el saldo global es coherente con la suma de cargos menos pagos (como hoy, salvo acuerdo de distribución).
6. Un **pago** de monto *M* no implica que exista una factura Tukifac por cada deuda: *M* se **imputa** según FIFO (automático) o según criterio manual (§4.7); una factura de *M* menor que una deuda concreta deja **saldo parcial** en esa deuda.

---

## 6. Pantallas / vistas (alto nivel)

- **Administración:** listado y ABM de categorías de planes; listado y ABM de planes y sus tramos.
- **Empresa:** en alta/edición, selector de plan, ciclo inicio/fin de mes, fechas de suscripción.
- **Procesos:** (opcional en UI) “Ejecutar liquidación mensual” o solo proceso automático en servidor.
- **Estado de cuenta:** distinguir origen de **cargos**: recurrente plan, manual, otros; en **pagos**, mostrar vínculo a comprobante SUNAT (Tukifac) cuando exista (§10).
- **Conciliación Tukifac:** bandeja “comprobantes pendientes de vincular” (§10.4.1); opcional lista de pagos locales “sin comprobante en Tukifac” (§10.4.2); indicador o notificación de conteo pendiente tras sync.
- **Reportes:** opcional — ingresos por plan/categoría, morosidad por plan.

---

## 7. Preguntas abiertas para cerrar antes de implementar

1. **Fuente exacta** del monto “facturación del período” para asignar tramo (§4.3).
2. **Momento exacto** de generación del cargo en ciclo “inicio” vs “fin” de mes (día fijo, hábil, zona horaria).
3. **Moneda y redondeo** (soles, dos decimales, tolerancia en conciliación).
4. **Qué significa “límite de documentos”** operativamente y qué pasa al superarlo.
5. **Política de aplicación de pagos** cuando hay varios documentos abiertos: **cerrado en §4.7** — automático FIFO por antigüedad y opción manual; criterio exacto de “antigüedad” (emisión vs vencimiento) si hubiera conflicto.
6. **Planes históricos:** ¿migración masiva de empresas existentes a una categoría “Legacy” por defecto?
7. **Tukifac:** política de emisión (un comprobante por abono vs consolidado), alcance real del API y tratamiento del histórico sincronizado — ver §10.5.

---

## 8. Criterios de aceptación (borrador)

- Dada una categoría con dos planes distintos, cada uno con tramos distintos, al asignar una empresa a un plan y ejecutar la liquidación de un mes, el monto del cargo recurrente coincide con el tramo correcto según la facturación calculada del período.
- Dada una empresa con ciclo “fin de mes”, no se genera el cargo de ese mes hasta cumplirse la regla de cierre acordada.
- No se duplican cargos recurrentes para el mismo mes-servicio y empresa.
- Es posible registrar tres cargos manuales y un pago parcial; el estado de cuenta refleja saldo y descripciones coherentes.
- Dada una empresa con cargos pendientes por 200 + 300 + 500 y un pago de 100 con **imputación automática**, el sistema aplica los 100 al cargo más antiguo y deja 100 pendientes en esa línea; las demás líneas no cambian.
- Dado un cargo pendiente de 100 y un pago de 100 (p. ej. vinculado a factura Tukifac de 100), ese cargo queda **totalmente cubierto**; con pago de 50, queda **parcial** (50 pendiente en esa línea).
- Dado un pago del mismo monto, el usuario puede elegir **imputación manual** a un cargo específico distinto del más antiguo y el sistema valida que la suma imputada no exceda el monto del pago ni el pendiente de cada línea.

---

## 9. Nota sobre el código actual

El sistema ya modela **empresas**, **documentos** (cargos) y **pagos**. La sincronización con Tukifac, en la implementación vigente, **consume el listado de documentos del API de Tukifac y crea o actualiza registros locales de tipo `Document`** con `source = tukifac` (comprobantes traídos desde allí). **No** hay en ese flujo creación automática de filas en la tabla de **pagos**; el riesgo de modelo incorrecto aparece si esos comprobantes se **interpretan como deuda nueva** o se **asocian mentalmente a “pagos”** cuando en la realidad operativa son la **factura del estudio por lo ya cobrado** (véase §10).

Este requerimiento propone **nuevas entidades** (categoría, plan, tramos, suscripción) y **un proceso de generación** de documentos recurrentes, además de la **redefinición del rol de Tukifac** respecto a pagos y comprobantes (§10).

---

## 10. Integración Tukifac: flujo deseado, problema actual y reestructuración

### 10.1 Flujo de negocio correcto (fuente de verdad)

1. En **este sistema** se registran los **cargos** (mensualidades, trámites, planes, etc.) que conforman la **deuda** del cliente.
2. Los **pagos** que **reducen deuda** deben existir como registros locales (`Payment` u equivalente); el saldo debe basarse en **cargos − pagos** (más reglas de imputación del §4.7).
3. En **Tukifac** se emite el **comprobante fiscal** (factura/boleta) por el monto cobrado, según la práctica del estudio (por abono, consolidado mensual, etc.).

**Orden operativo ideal vs real (API solo lectura):** lo deseable es registrar primero el **pago** aquí y luego emitir en Tukifac. Si la API **solo permite listar**, en la práctica a menudo ocurre al revés (se factura en Tukifac y recién después se refleja la cartera). En ese caso la sincronización **no debe** asumir que el comprobante es un cargo nuevo: debe entrar a una **cola de conciliación** (§10.4.1) hasta vincularlo a un pago local. Así se mantiene la **fuente de verdad del saldo** en este sistema sin duplicar ni invertir conceptos.

### 10.2 Qué está mal alineado con esa lógica (situación a corregir)

- **Importar desde Tukifac listados de comprobantes y materializarlos como “documentos” de deuda** sin distinguir si cada ítem es:
  - comprobante de **honorarios del estudio al cliente** (consecuencia de un cobro), o
  - otro tipo de documento (p. ej. referencia a operaciones del cliente),
  conduce a **invertir la causalidad** (pareciera que “lo que viene de Tukifac” genera la deuda o el pago) o a **duplicar** conceptos si la deuda ya nació en este sistema.
- Cualquier práctica que trate la **cantidad de comprobantes en Tukifac** como proxy de **pagos registrados** en este sistema es **incorrecta** para el modelo deseado: los **pagos** deben nacer del registro de abono aquí; Tukifac debe **acreditar fiscalmente** ese cobro, no sustituirlo.

### 10.3 Principios de la reestructuración

| Principio | Detalle |
|-----------|---------|
| **Separación de conceptos** | **Deuda / cargos** y **pagos** viven en el core financiero local. **Comprobante fiscal** en Tukifac es un **anexo** vinculado (serie, número, XML/PDF, estado SUNAT, `external_id`). |
| **No traer “pagos desde Tukifac” como abonos automáticos** por el solo hecho de listar facturas; si se sincroniza algo desde Tukifac, debe **empalmarse** con un pago o cargo **ya existente** o quedar claramente como **solo referencia fiscal**, sin duplicar montos en cartera. |
| **Vinculación explícita** | Cada comprobante emitido en Tukifac por un cobro debe poder asociarse a **uno o más pagos** locales (relación 1–1 o N–1 según política fiscal). |
| **API Tukifac (acordado)** | Solo **listar** comprobantes. No hay emisión desde este sistema; la conciliación es por **pull + vínculo manual (o asistida)**. |

### 10.4 Modelo funcional objetivo (alto nivel)

#### 10.4.1 Bandeja “comprobantes Tukifac pendientes de vincular”

Es la pieza central cuando la emisión ocurre en Tukifac y solo se puede **sincronizar** el listado:

1. **Sincronización:** por cada ítem traído del API que corresponda a **comprobante del estudio al cliente** (honorarios / cobro), el sistema guarda o actualiza un registro de **comprobante fiscal externo** (no debe sumarse como **nuevo cargo de deuda** si la deuda ya está modelada con documentos internos).
2. **Estado de conciliación:** `pendiente_vincular` | `vinculado` | `descartado` (ej. comprobante de prueba, error de cliente, duplicado).
3. **Vista dedicada** (y opcionalmente **notificación** tras cada sync: contador “N pendientes”, badge en menú, o resumen en dashboard):
   - listado filtrable por fecha, empresa/RUC, monto, número de comprobante;
   - indicar si hay **deuda abierta** en la empresa para contextualizar la conciliación.
4. **Acciones del usuario** (al menos una debe existir; pueden combinarse):
   - **Crear pago desde comprobante:** genera un **Payment** por el **monto del comprobante** (y fecha razonable según emisión o vencimiento), empresa asociada al cliente del comprobante, y **vincula** en el mismo paso el ID/serie/número Tukifac; a continuación el usuario elige **imputación automática (FIFO por deuda más antigua)** o **manual** a cargo(s) específico(s), según §4.7 (no se asume solo “el más antiguo” sin dar esa opción).
   - **Vincular a pago ya existente:** si el cajero ya registró el pago en este sistema antes de que apareciera el ítem en sync, se asocia el comprobante Tukifac a ese pago (evita duplicar el abono); si el pago aún no tenía imputación, se completa aquí con automático o manual.
5. **Varias deudas, una factura menor:** el comprobante de S/ 100 con deuda total S/ 1 000 genera un pago de 100 que **no** debe interpretarse como “pago de todo”; la imputación (FIFO o manual) determina qué cargos se afectan y si alguno queda **parcialmente** pagado (§4.7.1–4.7.3).
6. **Protecciones:** no permitir vincular dos veces el mismo `external_id` Tukifac a dos pagos distintos; avisar si el monto del comprobante no coincide con un pago libre que el usuario intenta enlazar.

Este flujo es **correcto** para API solo listado: la sincronización **alimenta la cola fiscal**; el usuario **materializa o completa** el impacto en cartera con un **pago local** explícito.

#### 10.4.2 Flujo cuando el pago se registra primero en este sistema

1. Usuario registra **Payment** con estado fiscal `pendiente_comprobante` (u homólogo).
2. Operador emite en **Tukifac** fuera de línea.
3. Tras **sync**, el sistema puede **sugerir coincidencias** (misma empresa, monto y fechas cercanas) entre pagos pendientes de comprobante e ítems recién listados; el usuario confirma el **vinculación** en un clic.

#### 10.4.3 Actualización posterior

Sincronizaciones siguientes actualizan **metadatos** del comprobante vinculado (estado SUNAT, enlaces PDF/XML si el API los expone), **sin** crear un segundo pago.

**Complemento:** vista de “Pagos con comprobante pendiente en Tukifac” (inverso de la bandeja) para cerrar el circuito cuando se parte del registro local.

### 10.5 Decisiones abiertas (cerrar con el estudio y con Tukifac)

1. ¿Un **pago parcial** en la práctica fiscal genera **un comprobante por cada abono** o se **agrupa** por período/cliente? (Afecta cuántas filas llegan a la bandeja.)
2. **Cerrado para implementación:** la API **solo lista**; el flujo principal de integración es **§10.4.1** (bandeja) y **§10.4.2** (sugerencias).
3. ¿Qué hacer con **histórico** ya sincronizado como `Document` desde Tukifac: migración a entidad “comprobante fiscal / cola”, marca de tipo, o limpieza asistida?
4. Si se mantiene sync de **facturación del cliente** (ventas del cliente a terceros) para calcular tramos del plan (§4.3), ese flujo debe estar **claramente separado** del de **comprobantes del estudio al cliente** por honorarios/cobros (filtros por tipo de documento en Tukifac o reglas explícitas).

### 10.6 Criterios de aceptación (integración)

- Tras sincronizar, los comprobantes de cobro del estudio aparecen en la **bandeja de pendientes** hasta vincularse; **no** reducen el saldo de la empresa hasta existir el **Payment** vinculado (o creado desde la acción de conciliación).
- El usuario puede **crear un pago** desde un comprobante Tukifac o **vincular** a un pago ya registrado; en ambos casos el comprobante queda en estado `vinculado` y no es reutilizable.
- Un comprobante por monto **menor** que la deuda total genera un pago que **reduce parcialmente** el saldo según la política de imputación (§4.7).
- Queda documentado qué listados/endpoints de Tukifac sirven para **volumen de ventas del cliente** (planes) y cuáles para **comprobantes del estudio al cliente**, sin mezclar ambos en una sola semántica de “documento de deuda”.

---

## 11. Nota final sobre implementación

Este requerimiento propone **nuevas entidades** (categoría, plan, tramos, suscripción) y **un proceso de generación** de documentos recurrentes, más **campos o entidades de vínculo** pago ↔ comprobante Tukifac, y un modelo de **imputación multiparte** respecto al pago único por fila que existe hoy (§12).

---

## 12. Anexo: consistencia con la implementación actual y mejoras previas al desarrollo

*Revisión técnica del código (modelos y servicios principales) frente a este documento. Sirve para planificar migraciones y orden de trabajo.*

### 12.1 Lo que ya encaja con el requerimiento

| Aspecto | Implementación actual | Alineación |
|--------|------------------------|------------|
| **Empresa como deudor** | `Company` con documentos y pagos asociados | Coherente con cartera por cliente. |
| **Cargos** | `Document` con `company_id`, `total_amount`, `status` (`pendiente`, `parcial`, `pagado`, `anulado`), `source` (`manual`, `tukifac`) | Los cargos manuales y la idea de “línea de deuda” coinciden con §4.6; falta extender `source` / metadatos para `recurrente_plan` (§4.5). |
| **Pagos y parcialidad por documento** | `Payment` con `document_id` opcional; `recalculateDocumentStatusTx` pasa a `parcial` / `pagado` según suma de pagos | Coherente con **un** documento por pago aplicado. |
| **Pagos a cuenta** | `type = on_account` sin `document_id` | Coincide con §4.7.4 opcional; reduce el saldo global en `GetCompanyBalance`. |
| **Estado de cuenta** | `FinanceService.GetCompanyStatement`: documentos con pagos cargados + listado de pagos + totales | Base útil para enriquecer con origen de cargo y vínculo Tukifac. |
| **Tukifac sync** | `TukifacService.SyncDocuments` → crea/actualiza `Document` con `source = tukifac` | Coincide con la descripción del §9; **no** cumple aún el modelo objetivo del §10 (cola fiscal vs deuda interna). |

### 12.2 Brechas importantes (requerimiento vs código)

1. **Planes y suscripciones**  
   No existen entidades para categoría de plan, plan, tramos de facturación ni asignación a empresa (`ciclo inicio/fin de mes`, fechas). `Company` no tiene FK a plan. **Todo el bloque §4.1–4.5 es nuevo.**

2. **Imputación FIFO / multiparte (§4.7)**  
   Hoy un `Payment` **aplicado** exige **un solo** `document_id` por fila. Un pago de S/ 100 que en FIFO afecta solo parcialmente al documento más antiguo encaja; pero si el **remanente** debiera aplicarse al **siguiente** documento, el requerimiento habla de **un mismo Payment con varias líneas de imputación**. Eso **no está modelado**: haría falta, por ejemplo, tabla `payment_allocations` (`payment_id`, `document_id`, `amount`) con `Payment.document_id` nullable solo como atajo legacy, **o** crear **varias filas** `Payment` con un `group_id` / referencia común y un solo vínculo Tukifac en el grupo. **Convención a decidir** y documentar en implementación.

3. **Saldo global vs pagos a cuenta**  
   `GetCompanyBalance` y el estado de cuenta usan `SUM(payments)` por empresa. Los `on_account` **sí** reducen `Balance`. Las líneas por documento solo suman pagos con `document_id` igual; un pago a cuenta puede dejar **desalineación visual** (deuda por línea que no cuadra con el saldo global) hasta que se distribuya. El requerimiento debería **explicitar** si en v1 se mantiene `on_account` masivamente o se prefiere **siempre imputar** al registrar (§4.7.4).

4. **Documentos anulados en totales**  
   El cálculo de `totalDocs` en `GetCompanyBalance` / statement **no excluye** `status = anulado`. Riesgo de saldo inflado. **Mejora transversal** recomendada al tocar finanzas.

5. **Campo descripción / mes de servicio en cargos**  
   `Document` no tiene `description` o `concept`; para §4.5 (texto tipo “Mensualidad plan X — YYYY-MM”) hace falta campo o convención sobre `type`/`number`.

6. **Tukifac**  
   No existe entidad “comprobante pendiente de vincular”, ni `Payment` con referencia a Tukifac (`external_id` fiscal, estado `pendiente_comprobante`). El sync actual **sigue escribiendo en `documents`**, lo que choca con §10 hasta que se migre a otra tabla o a `source`/tipo discriminado.

7. **§4.3 Facturación para tramos**  
   Depende de separar en datos/API qué comprobantes Tukifac son **ventas del cliente** vs **honorarios del estudio**; el listado actual no discrimina en código.

### 12.3 Mejoras sugeridas al propio requerimiento (redacción / alcance)

- **§4.7 / implementación:** añadir nota explícita: “La imputación multiparte se implementará vía *tabla de distribuciones* o *N pagos hijos con id de grupo*; una sola fila `Payment` con un solo `document_id` no es suficiente para el FIFO multi-documento en un solo movimiento contable.”
- **§10:** referenciar **estrategia de migración** del histórico `Document` + `source=tukifac` (script vs convivencia con nuevos tipos).
- **Cierre §7.5:** fijar un solo criterio de orden FIFO (**fecha de emisión** del cargo como predeterminado) y mencionar vencimiento solo como alternativa configurable.
- **Auditoría:** decidir si conviene registrar usuario/fecha en conciliación Tukifac y en cambios de imputación (no estaba en el borrador).

### 12.4 Orden de implementación sugerido (sin obligar)

1. Ajustes de **consistencia financiera** (excluir anulados en saldos; documentar o restringir `on_account` frente a imputación obligatoria).  
2. Extensión de **Document** (descripción, `source` o categoría para `recurrente_plan`) y modelo de **imputación multiparte** + API/UI de pagos.  
3. **Maestros** categoría / plan / tramos y campos en **Company** + job de liquidación mensual.  
4. Refactor **Tukifac**: nueva entidad cola + vínculo a `Payment`; separación de tipos de listado para §4.3 vs honorarios; bandeja UI.

### 12.5 Conclusión

El requerimiento es **internamente coherente** y describe bien el negocio discutido. Respecto al sistema actual, la base **empresa–documento–pago** es la correcta, pero hay **desalineación estructural** en: (a) multiparte/FIFO en un solo evento de pago, (b) rol de Tukifac como documento de deuda, (c) ausencia total de planes/suscripciones, (d) detalles de saldo y anulados. Conviene **cerrar las decisiones del §12.3 y §7** y luego implementar por fases según §12.4.

---

*Documento generado para revisión previa a cualquier implementación.*
