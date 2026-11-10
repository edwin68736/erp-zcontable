# Notificaciones SUNAT: aviso de «sin leer», botón «Ingresar a SUNAT» y pasadas del día

Estado: implementado el 2026-11-10 (sin desplegar a producción al momento de escribir esto).

## Qué es «sin leer»

El estado «leído» lo decide SUNAT (`leido` de cada mensaje del Buzón Electrónico SOL). El sistema **nunca abre un mensaje**
(abrirlo, o bajar un adjunto, lo marca como leído en SUNAT: `obtenerDetalleNotiMen` devuelve `updateLeido`), así que solo
cambia cuando alguien lo lee en SUNAT y el sistema se entera en la siguiente sincronización. **No se descargan adjuntos desde
el ERP** (decisión del 2026-11-10): se ve el clip con la cantidad y se leen/descargan entrando a SUNAT.

Para avisar cuentan solo las **notificaciones** (tipo 2) que siguen en el buzón; los mensajes (tipo 1) son informativos y son la
gran mayoría (en la copia local: 3,386 «no leídas» entre todo, pero 461 notificaciones).

## Quién ve qué

`GET /api/tools/buzon/unread` respeta el alcance de quien consulta (el mismo de `/tools/buzon/:companyId`):
asistente y supervisor, solo las empresas que tienen asignadas; administrador (alcance de todo el estudio), todas.

## Dónde se ve

- **Aviso flotante** (`BuzonUnreadReminder`, esquina inferior derecha, encima de la agenda del calendario): total, empresas con
  más pendientes (urgentes primero), antigüedad; cada fila abre `/tools/notificaciones-sunat/:id?tipo=2&no_leidas=1`.
  Se abre solo la primera vez de la sesión y cuando llegan más que las ya vistas; se minimiza a un círculo con el contador. En
  las pantallas de Notificaciones SUNAT queda como círculo (no tapa los botones). Avisa también cuántas empresas **no se
  pudieron revisar** (clave rechazada o error): ahí «sin avisos» no significa «sin notificaciones».
- **Campana** de la cabecera: suma el total y lista las 3 primeras empresas.
- **Lista de empresas**: columna «Notif. sin leer» y botón «Con notificaciones sin leer (N)» (`?pendientes=1`).
- **Detalle de la empresa**: contador «Notif. sin leer», filas sin leer resaltadas (punto ámbar), filtros precargados por URL.
- Estado compartido en `utils/buzonUnread.ts` (una consulta cada 5 min, al volver a la pestaña y tras sincronizar).

## «Ingresar a SUNAT»

Botón en el detalle de la empresa (reutiliza `SunatAccessModal` de Claves SOL: abre una pestaña ya dentro del Menú SOL o muestra
las claves para ingresar a mano). Al volver, un aviso invita a pulsar **«Actualizar lo leído»** (la sincronización de esa
empresa). **No se sincroniza sola al volver**: la sincronización entra a SUNAT con la clave de la empresa y cierra la sesión
que la persona tenga abierta en SUNAT.

## Pasadas del día

`StartSunatBuzonNightlySync` ahora corre a las horas de `BUZON_SYNC_HOURS` (hora de Lima; por defecto `1,8,13,17`). La de la
madrugada se registra como «nocturna»; las demás, «programada». **Una pasada de todo el estudio dura más de media hora**
(unos 9 s por empresa entre ingreso y pausa de 6 s; 256 empresas ≈ 38 min). Para no bloquear a nadie, una sincronización
**manual tiene prioridad**: espera a que termine la empresa en curso y la pasada le cede el paso antes de la siguiente.
En el ambiente de pruebas siguen desactivadas (`BUZON_SYNC_NIGHTLY=false`). Para volver al comportamiento anterior en producción:
`BUZON_SYNC_HOURS=1`.
