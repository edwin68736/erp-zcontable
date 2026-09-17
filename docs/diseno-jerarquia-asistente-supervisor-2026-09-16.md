# Diseño: jerarquía real Asistente → Supervisor

**Fecha**: 2026-09-16. **DESCARTADO — no se implementa.** Ver §7. Se deja este documento como registro
del análisis y de por qué se rechazó, en vez de borrarlo, siguiendo el mismo criterio que ya se usó en
este repo para auditorías que concluyeron "no hace falta cambiar nada" (ej. Fase 3 del blueprint
financiero, Reporte de Deudas).

---

## 0. Por qué se descartó (leer esto primero)

Este documento partía de un supuesto que resultó ser incorrecto: que "un asistente debería tener
siempre un único supervisor fijo", y que verlo distinto entre empresas era necesariamente un error de
carga. **Se confirmó con el estudio que NO es así** — la supervisión se define por empresa/cliente, no
por persona: es normal y esperado que un mismo asistente reporte al Supervisor A por una empresa y al
Supervisor B por otra, según qué cartera atiende cada supervisor. No es una inconsistencia a corregir,
es cómo funciona el negocio.

Con ese supuesto caído, el problema que este documento intentaba resolver deja de existir: el dato que
ya existe hoy, por empresa (`Company.SupervisorUserID`/`Company.AssistantUserID`), **es correcto y
suficiente** para evaluar el desempeño de cada supervisor y de cada asistente — ver §7 para el detalle.
No hace falta ningún campo nuevo en `User`, ninguna migración, ninguna jerarquía. El resto de este
documento (§1-6) queda como el análisis original, sin editar, para que quede claro qué se consideró y
por qué ya no aplica.

---

## 1. Problema (verificado en el código, no es una suposición)

Hoy **no existe en ningún lado del modelo de datos el hecho "este asistente reporta a este
supervisor"**. Verificado en `backend/models/user.go`: el struct `User` no tiene ningún campo de
jerarquía — solo `Roles []Role` (permisos RBAC, muchos-a-muchos, sin relación con "quién le reporta a
quién"). Grepeado también todo el backend por `ManagerID`/`SupervisorID`/`TeamID`/`DepartmentID`: no
aparece nada fuera de `Company`.

Lo único que existe hoy es **por empresa, no por persona**:

```go
// backend/models/company.go
SupervisorUserID *uint  // supervisor de ESTA empresa
AssistantUserID  *uint  // asistente de ESTA empresa
```

Se cargan de forma **totalmente independiente** al crear/editar una empresa
(`backend/services/company_service.go`, `validateSupervisorForCompany`/`validateAssistantForCompany`) —
cada validador solo chequea que el usuario elegido esté activo y tenga el permiso correspondiente
(`CompaniesAssignSupervisor`/`CompaniesAssignAssistant`, o `AccessStudio`). **Nada valida que el
supervisor elegido para una empresa sea realmente "el" supervisor del asistente elegido para esa misma
empresa.** En el frontend (`CompanyForm.tsx`), son dos `SearchableSelect` completamente
independientes — elegir un asistente no filtra, sugiere ni preselecciona ningún supervisor.

**Consecuencia concreta**: el mismo asistente podría terminar con supervisores distintos en distintas
empresas, sin que el sistema lo note ni lo impida. Un reporte "desempeño por supervisor" armado
agrupando por `Company.SupervisorUserID` heredaría ese error en silencio — una empresa mal cargada
contaría bajo el supervisor equivocado (o no contaría en ningún lado), sin ninguna señal de alerta.

## 2. Diseño propuesto

### 2.1 — Nuevo campo, en el usuario, no en la empresa

```go
// backend/models/user.go
SupervisorID *uint `gorm:"index" json:"supervisor_id,omitempty"`
Supervisor   *User `gorm:"foreignKey:SupervisorID" json:"supervisor,omitempty"`
```

Un solo dato, fijo por persona, independiente de cuántas empresas tenga asignadas. Aplica
semánticamente a usuarios con permisos de asistente (mismo criterio de permisos que ya usa
`validateAssistantForCompany`, no un chequeo de nombre de rol — así sigue funcionando aunque el estudio
cree un rol personalizado con esos mismos permisos).

**Alcance deliberadamente acotado**: esto modela únicamente Asistente→Supervisor, que es lo que se
necesita para evaluar PDT601/621. No se modela toda la cadena organizacional (Supervisor→Gerencia,
etc.) — los roles `Gerencia` y `Supervisor` hoy tienen el mismo conjunto de permisos en
`backend/rbac/registry.go` (son pares entre sí, no uno reporta al otro en el código), así que extender
la jerarquía más arriba no tiene un criterio claro todavía y queda fuera de este documento.

### 2.2 — Validación al guardar

Se reutiliza tal cual el validador que ya existe para el mismo propósito en empresas
(`validateSupervisorForCompany`, `company_service.go`) — el supervisor elegido debe estar activo y
tener `CompaniesAssignSupervisor` o `AccessStudio`. No hace falta inventar una regla nueva.

### 2.3 — Relación con `Company.SupervisorUserID`: no se elimina, se convierte en default-con-override

Ya existe un patrón exacto para esto en el código, en otro módulo completamente distinto — vale la pena
copiarlo tal cual en vez de inventar uno nuevo: `backend/services/pos_sale_service.go` (precio de línea
en una venta POS) resuelve el valor **por defecto desde la fuente canónica** (precio de catálogo del
producto), pero acepta un **override explícito** si quien lo hace tiene permiso — sin ese permiso, un
valor distinto al default es un error duro, no algo que se ignore en silencio.

Aplicado acá:

- Al elegir un Asistente en `CompanyForm.tsx`, el campo "Supervisor" se **autocompleta** con
  `Assistant.SupervisorID` (si el asistente elegido tiene uno cargado).
- Sigue siendo editable — un supervisor puntual distinto para una empresa específica sigue siendo
  posible (ej. un caso especial que un supervisor sénior quiere seguir personalmente), no se le quita
  flexibilidad al estudio.
- **Lo que cambia de fondo es para qué se usa cada dato**: `Company.SupervisorUserID` sigue siendo "quién
  supervisa esta empresa hoy" (con override posible); `Assistant.SupervisorID` es "a quién le reporta
  este asistente" (el dato canónico, estable). **El reporte de desempeño agrupa siempre por el segundo,
  nunca por el primero** — así una empresa con un override puntual no distorsiona la evaluación del
  supervisor real del asistente.

### 2.4 — Dónde se edita

`UserForm.tsx` no tiene hoy ningún campo condicional (todos los campos se muestran siempre,
verificado). Se agrega un nuevo comportamiento: un select "Supervisor" que aparece solo cuando el rol
elegido en el formulario es de tipo asistente — mismo criterio de clasificación por permisos que ya usa
`frontend/src/rbac/userRoles.ts` (`userIsTeamAssistantOrAdmin`) para filtrar los dropdowns de
`CompanyForm.tsx`, reutilizado acá en vez de inventar un criterio nuevo.

## 3. Migración de datos existentes

No se puede simplemente "adivinar" el supervisor de cada asistente ya cargado — hay que construirlo con
evidencia de los datos actuales y dejar a la vista los casos dudosos, mismo criterio que ya se usó en
este sistema para otros backfills históricos (Fase 2.1-2.2 del blueprint financiero: *"backfill de
datos históricos con evidencia, nunca inventado"*).

**Paso 1 — Reporte de auditoría (solo lectura, no escribe nada)**: para cada `AssistantUserID` presente
en `companies`, agrupar por `SupervisorUserID` y contar cuántas empresas caen en cada combinación:

```sql
SELECT assistant_user_id, supervisor_user_id, COUNT(*) AS n
FROM companies
WHERE assistant_user_id IS NOT NULL
GROUP BY assistant_user_id, supervisor_user_id
ORDER BY assistant_user_id, n DESC;
```

Con este resultado se separan dos grupos:
- **Consistentes**: el asistente tiene un único `supervisor_user_id` en todas sus empresas (o una
  mayoría abrumadora, con 1-2 excepciones aisladas) → se puede autocompletar con confianza.
- **Inconsistentes**: el asistente aparece repartido entre 2+ supervisores sin un patrón claro → **no se
  autocompleta**, queda listado explícitamente para que un administrador decida a mano cuál es el
  supervisor real.

**Paso 2 — Aplicar solo lo consistente**: siguiendo el patrón ya establecido en este repo
(`backend/cmd/activity-backfill-report`, `activity-migration-audit`,
`activity-rule-backfill-audit` — todos herramientas de línea de comandos separadas, auditoría primero,
aplicación después), se propone un `backend/cmd/assistant-supervisor-backfill` con dos modos: uno que
solo imprime el reporte (para revisar antes de tocar nada), y otro que aplica el `SupervisorID` a los
casos consistentes, dejando null los inconsistentes hasta que se carguen a mano.

**Paso 3 — Revisión manual de los casos inconsistentes**: quedan con `SupervisorID = NULL` hasta que
alguien con acceso a `UserForm.tsx` los complete explícitamente — no se toma ninguna decisión automática
sobre esos casos.

## 4. Cómo esto alimenta el reporte de desempeño (conecta con el otro documento)

Una vez que `Assistant.SupervisorID` es confiable, el dashboard/reporte de PDT601/621
(`docs/diseno-estados-pdt601-pdt621-2026-09-16.md`, §12) puede agregar de forma correcta:

- **Por asistente**: cuántas declaraciones quedaron Entregado a tiempo / Entregado fuera de fecha /
  Observado / Pendiente, en sus empresas asignadas (`Company.AssistantUserID = X`) — esto ya funciona
  hoy sin cambios, es una relación directa y sin ambigüedad.
- **Por supervisor**: la suma de esos mismos números para **todos los asistentes cuyo
  `SupervisorID` sea ese supervisor** — el dato confiable, no `Company.SupervisorUserID` (que puede
  tener overrides puntuales que no reflejan la relación de reporte real).

## 5. Plan de implementación (checklist, alto nivel)

- [ ] `backend/models/user.go`: campo `SupervisorID *uint` + relación `Supervisor *User`.
- [ ] Reutilizar `validateSupervisorForCompany` (o extraer su lógica a un helper compartido) para
      validar `User.SupervisorID` al guardar un usuario.
- [ ] `backend/services/user_service.go` / `user_controller.go`: aceptar y persistir `supervisor_id`
      en Create/Update.
- [ ] `frontend/src/pages/UserForm.tsx`: nuevo select "Supervisor", visible solo cuando el rol
      seleccionado es de tipo asistente (mismo criterio de `userIsTeamAssistantOrAdmin`).
- [ ] `frontend/src/pages/CompanyForm.tsx`: autocompletar "Supervisor" desde `Assistant.SupervisorID`
      al elegir un asistente, dejando el campo editable (override posible, sin permiso nuevo).
- [ ] `backend/cmd/assistant-supervisor-backfill`: herramienta de auditoría + aplicación, siguiendo el
      patrón ya usado por las demás herramientas de `backend/cmd/`.
- [ ] Ejecutar el backfill contra producción, revisar el reporte de inconsistencias con el estudio,
      completar a mano los casos dudosos.
- [ ] Solo después de esto: retomar la implementación de
      `docs/diseno-estados-pdt601-pdt621-2026-09-16.md`, usando `Assistant.SupervisorID` como criterio
      de agrupación en el reporte de desempeño por supervisor (§12 de ese documento).

## 6. Decisiones de diseño ya cerradas

1. Se modela únicamente Asistente→Supervisor, no toda la cadena organizacional — Gerencia/Supervisor
   son pares en RBAC hoy, no hay una relación clara que modelar ahí todavía.
2. `Company.SupervisorUserID` no se elimina — pasa a comportarse como un override con default (mismo
   patrón ya usado en `pos_sale_service.go` para precios de línea), autocompletado desde
   `Assistant.SupervisorID` pero editable.
3. El reporte de desempeño por supervisor agrupa siempre por `Assistant.SupervisorID` (el dato
   canónico), nunca por `Company.SupervisorUserID` (que puede tener overrides puntuales).
4. La migración de datos existentes no adivina: autocompleta solo los casos consistentes y deja
   explícitamente pendientes de revisión manual los casos donde un asistente aparece con más de un
   supervisor en sus empresas actuales.
5. ~~Este documento es un prerrequisito de `docs/diseno-estados-pdt601-pdt621-2026-09-16.md` — se
   implementa primero.~~ **Sin efecto — ver §7, el documento completo quedó descartado.**

## 7. Qué se usa en su lugar (confirmado con el estudio)

La supervisión se define **por empresa/cliente**, no por persona — es normal y esperado que un mismo
asistente reporte a distintos supervisores según qué empresa esté atendiendo, porque cada supervisor es
responsable de ciertas carteras, no de ciertos asistentes. Con esto confirmado:

- **No hace falta ningún campo nuevo.** El dato que ya existe (`Company.SupervisorUserID`,
  `Company.AssistantUserID`) es la fuente correcta, no una aproximación con riesgo de inconsistencia.
- **Desempeño de un supervisor** = agregar todas las declaraciones PDT601/621 de las empresas donde
  `Company.SupervisorUserID = ese supervisor`, sin importar qué asistente las atendió. Ya es lo que
  hace `AccessService.GetAllowedCompanyIDs`/`PdtDashboardSummary` hoy — sin cambios.
- **Desempeño de un asistente** = lo mismo, filtrando por `Company.AssistantUserID = ese asistente`
  en vez de por supervisor. Mismo mecanismo, ya disponible.
- Para "qué asistente y qué supervisor le corresponden a un registro puntual mal cargado" — eso ya se
  responde hoy mismo, directo desde la empresa de ese registro, sin ambigüedad ninguna.

El documento `docs/diseno-estados-pdt601-pdt621-2026-09-16.md` queda **sin ningún prerrequisito
pendiente** — se puede implementar tal como está, usando `Company.SupervisorUserID`/`AssistantUserID`
directamente para las agregaciones del dashboard (§12 de ese documento).
