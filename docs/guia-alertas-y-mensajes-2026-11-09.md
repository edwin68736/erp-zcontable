# Guía de alertas y mensajes (retroalimentación tras una acción)

Estado: vigente desde la fase 5 de las alertas centradas (2026-11-09). Código: `frontend/src/utils/notify.ts`
(núcleo y API), `frontend/src/components/NotifyHost.tsx` (dibujo, montado una vez en `layouts/Layout.tsx`) y
`frontend/src/components/ui/Alert.tsx` (aviso en línea).

## 1. Principio

Toda acción de la persona (guardar, eliminar, aprobar, subir, descargar, exportar, activar/desactivar…) termina con
**una señal visible y única, en el centro de la pantalla**. Antes cada pantalla avisaba a su manera (un aviso en la
esquina, un banner en la página, un texto junto al botón o nada), y la misma acción se veía distinta según la vista.

Las acciones triviales (copiar, marcar como visto, quitar un item del historial, descargar) usan el mismo sistema que las
importantes: la consistencia importa más que el tamaño de la acción.

## 2. Qué usar en cada caso

| Situación | Qué se usa | Cómo se comporta |
|---|---|---|
| La acción salió bien | `notify.success(título, texto?)` | Se cierra sola a los 2,2 s (barra de tiempo). Un clic o Esc la cierra antes. Se pausa con el mouse encima. |
| La acción falló | `notify.error(título, texto?)` | No se cierra sola: hay que aceptar. |
| Falta un dato o no se puede hacer ahora (validación) | `notify.warning('Revise los datos', texto)` | Pide aceptar. |
| Salió bien a medias | `notify.warning(título, texto)` | Ej.: «Pago guardado» / «No se pudo emitir el comprobante: …». |
| Dato informativo sin acción | `notify.info(título, texto?)` | Se cierra sola a los 3,5 s. |
| Preguntar antes de actuar | `await notify.confirm({ message, danger?, confirmLabel? })` o `confirmDialog(...)` | Devuelve `true`/`false`. En acciones destructivas el foco empieza en «Cancelar». |
| Mensaje ya armado o del servidor | `notify.fromMessage('success' \| 'error' \| 'info', mensaje)` | Decide título y texto por el largo (ver 3.4). |
| Confirmación con campos extra, `loading` o botón deshabilitable | `<ConfirmDialog …/>` (controlado por estado) | Mismo aspecto que las alertas. |

### Qué NO va en una alerta (se queda en la página, con `Alert`)

- **Estados de la pantalla:** «No hay calendario para este mes», «Empresa no válida», listas vacías.
- **Errores de carga de datos:** «No se pudo cargar…» con su botón de reintento.
- **Errores de campos de un formulario de acceso:** Login, cambio de contraseña, código de verificación en dos pasos,
  confirmación de contraseña: el error se corrige ahí mismo.
- **Errores estructurados** con detalle técnico o reintento (SIRE: `SireErrorBox`).
- **Resultados persistentes de un proceso dentro de un modal** (por ejemplo la validación de un archivo de importación).

Regla práctica: si el mensaje describe **el resultado de lo que la persona acaba de hacer**, es una alerta; si describe
**cómo está la pantalla**, es un `Alert` en línea.

### Consultas largas a SUNAT

SIRE, RH, ITF, NPD, DAM y Buzón SOL tardan segundos o minutos. **No** usan el modal central ni `notify.loading` (bloquearían
la pantalla): tienen un tratamiento propio, sin tocar el servidor.

| Pieza | Dónde | Qué hace |
|---|---|---|
| Registro `utils/longTasks.ts` | memoria de la aplicación (fuera de los componentes) | Sigue cada consulta aunque la persona cambie de pantalla. Una consulta por herramienta y empresa (`rh:42`). |
| `LongTaskPanel` | dentro de la página, donde luego aparece el resultado | Título, empresa y rango, «Lleva m:ss», barra indeterminada, aviso ámbar a los 45 s («SUNAT está tardando más de lo normal»), enlace «Seguir en segundo plano». **No** hay botón de cancelar: no se puede abortar la llamada a SUNAT. |
| `TaskIndicator` | cabecera, junto a la campana | «N consultas en curso» / «N lista(s)» / «N con error» y una lista desplegable con «Ver». |

Cómo se usa en una pantalla:

```ts
const task = useTask(taskKey('rh', companyId));          // la consulta en curso o la última terminada
const loading = task?.status === 'running';
const ownTask = useRef<number | null>(null);

const run = async () => {
  const t = startTask({ tool: 'rh', toolLabel: 'RH', companyId, companyName, detail: 'Recibidos · 10/05 – 09/11', href: `/tools/rh/${companyId}` });
  ownTask.current = t.id;
  try {
    const r = await rheService.list(...);
    finishTask(t.id, { resultId: r.history_id });          // la pantalla muestra r como siempre
  } catch (e) {
    failTask(t.id, e);                                     // y muestra su error en línea (SireErrorBox)
  }
};

// «Salí y volví»: la pantalla se montó de nuevo y no tiene la respuesta; la lee del historial del servidor.
useTaskSettled(taskKey('rh', companyId), ownTask, (done) => { /* abrir done.resultId o mostrar done.errorMessage */ });

// En el JSX, en el lugar del resultado:
<LongTaskPanel task={task} hint="…" />
```

SIRE y DAM ya son asíncronos en el servidor (el historial queda `en_proceso`): sus pantallas **adoptan** las filas
en proceso con `trackAsync`, que sondea cada 5 s aunque la persona se haya ido. Así también se siguen las consultas
que se iniciaron antes de recargar la página (el tiempo «Lleva» sale de `created_at`).

**Qué avisa al terminar:**

- La persona sigue en la pantalla de la consulta: el resultado o el error aparece en la página y además sale la alerta central: «Consulta lista» con un resumen (`finishTask(id, { summary: '3 comprobantes' })`, se cierra sola) o «No se pudo completar la consulta» (pide aceptar; el detalle y «Reintentar» siguen en la página).
- Está en otra pantalla y fue un **error**: alerta central «No se pudo completar la consulta» con «Ver detalle» / «Cerrar».
- Está en otra pantalla y fue un **éxito que tardó 2 min o más**: alerta central «Consulta lista» con «Ver resultado» / «Cerrar».
- Está en otra pantalla y fue un éxito corto: solo cambia el indicador de la cabecera (no se interrumpe a nadie).

Límites conocidos: las tareas viven en memoria (si se recarga la página se pierden; las de SIRE/DAM se readoptan porque
el servidor las guarda como «en proceso»; RH/ITF/NPD/Buzón dejan su resultado guardado, pero la petición en vuelo se
pierde al recargar). Pasar RH/ITF/NPD/Buzón a asíncronos en el servidor (con progreso por tramo) queda como mejora futura.

## 3. Cómo se escribe

Reglas de redacción (voz del producto, español, sin primera persona):

1. **Título corto, en pasado, sin punto final.** «Usuario guardado», «Empresa eliminada», «Excel descargado».
2. **Sin relleno:** nada de «correctamente», «exitosamente», «con éxito», «por favor».
3. **Un título de máximo ~60 caracteres.** Si hace falta más, va en el segundo parámetro (texto):
   `notify.success('Cliente registrado', 'Ya puede usarlo en la venta')`.
4. **Errores: qué pasó y, si se sabe, qué hacer.** Título «No se pudo eliminar la empresa» y debajo el motivo del servidor
   o la acción: «Revise su conexión y vuelva a intentarlo». Nunca mostrar una excepción cruda.
5. **«No se pudo…» en vez de «Error al…».** «No se pudo guardar la configuración», no «Error al guardar configuración».
6. **Validaciones: título «Revise los datos»** y el texto dice qué falta: «Seleccione el régimen laboral».
7. **Usted, no tú.** «Complete el usuario…», no «Completa…». (Hay textos antiguos con «tú»; al tocarlos se corrigen.)
8. **«Periodo»**, sin tilde, como escribe SUNAT.
9. **Importes y fechas** con `formatAmount` / `formatMoneyPen` / `formatDate*` de `utils/format.ts`
   (`S/ 12,500.50`, `08/11/2026 15:30`), nunca `toFixed` ni `toLocaleString()` sin idioma.
10. Una sola oración por título; no empezar con «Se ha…».

### 3.1 Catálogo de títulos habituales

| Acción | Éxito | Fallo |
|---|---|---|
| Crear | «X creado/a» | «No se pudo crear X» |
| Guardar / actualizar | «X guardado/a» o «X actualizado/a» | «No se pudo guardar X» |
| Eliminar | «X eliminado/a» | «No se pudo eliminar X» |
| Activar / desactivar | «X activado/a» / «X desactivado/a» | «No se pudo cambiar el estado» |
| Aprobar / rechazar | «Entrega aprobada» / «Equipo rechazado» | «No se pudo aprobar» |
| Subir | «Archivo cargado» | «No se pudo subir el archivo» |
| Descargar / exportar | «Excel descargado», «PDF generado» | «No se pudo generar el PDF» |
| Quitar de un historial | «Consulta quitada» | «No se pudo quitar» |
| Limpiar | «Historial limpiado» | «No se pudo limpiar» |

### 3.2 Confirmaciones

- Pregunta concreta que nombre lo que se afecta: «¿Eliminar este usuario?» + una línea con la consecuencia
  («Maria Quispe perderá el acceso al sistema. Esta acción no se puede deshacer.»).
- Botón de confirmar con el **verbo de la acción** («Eliminar», «Quitar», «Descartar», «Aprobar»), no «Aceptar».
- `danger: true` solo si destruye o es irreversible (botón rojo, foco en «Cancelar»).

### 3.3 Cuándo `success` y cuándo `info`

`success` confirma algo que la persona hizo. `info` avisa algo que ocurrió o que debe saber y no es resultado de una
acción suya (por ejemplo, otra persona está sincronizando la empresa).

### 3.4 Mensajes del servidor (`fromMessage`)

`notify.fromMessage(tipo, mensaje)` aplica la regla de los avisos antiguos: una frase de hasta 60 caracteres es el título;
una más larga queda como texto bajo un título genérico («Listo», «Aviso»). En errores, el título es «No se pudo completar»
y el mensaje va debajo (salvo que ya empiece con «No se pudo» y sea corto). Úselo para texto que llega armado; para
mensajes que usted escribe, prefiera `success`/`error`/`warning` con título propio.

## 4. Comportamiento y accesibilidad (ya resuelto en `NotifyHost`)

- Una alerta a la vez; las demás esperan su turno. Un éxito nuevo reemplaza al éxito visible (no se apilan «Guardado»).
  Un aviso idéntico al último pendiente no se repite.
- Éxito/información: `role="status"`, no roban el foco. Error/advertencia/confirmación: `role="alertdialog"`, el foco
  entra al botón seguro, Tab no sale del diálogo y el foco vuelve a donde estaba al cerrar. Escape cancela.
- Con «reducir movimiento» del sistema, no hay animaciones.
- Los diálogos se montan fuera del panel con `backdrop-blur` del Layout; dentro de él quedarían centrados en el panel y
  no cubrirían la cabecera ni el menú.
- Sin componente de dibujo (pruebas, o fuera del Layout) se cae al `alert`/`confirm` del navegador: nada se pierde.

## 5. Cómo agregar un aviso en una pantalla nueva

```ts
import { notify } from '../utils/notify';

const guardar = async () => {
  try {
    await usersService.update(id, payload);
    void notify.success('Usuario guardado');
  } catch (e) {
    notify.fromMessage('error', extractApiErrorMessage(e, 'No se pudo guardar el usuario'));
  }
};

const eliminar = async () => {
  if (!(await notify.confirm({ message: '¿Eliminar este usuario?', confirmLabel: 'Eliminar', danger: true }))) return;
  // …
};
```

- Llame a `notify.*` **después** de que la acción termine, no antes.
- Si va a navegar a otra pantalla, avise antes de `navigate(...)`: la alerta es global y sigue visible sobre la pantalla nueva.
- `void` delante de `notify.success(...)` cuando no se espera; use `await notify.error(...)` si lo que sigue depende de que
  la persona acepte.

## 6. Qué impide que se vuelva atrás

`frontend/src/utils/notify.guard.test.ts` falla si alguien:

- envía el evento antiguo `miweb:toast` a mano (el Layout lo conserva solo por compatibilidad), o
- usa `window.confirm` / `alert` del navegador.

`frontend/src/utils/longTasks.test.ts` cubre el registro de consultas largas (en curso, terminada, error, sondeo, avisos).
`frontend/src/utils/notify.test.ts` cubre la cola, los temporizadores, la pausa, los reemplazos y las confirmaciones.
Las alertas se verificaron visualmente en navegador (éxito, error, advertencia, confirmación, cola y teclado).

## 7. Pendientes conocidos

- Consultas largas a SUNAT en el servidor (RH/ITF/NPD/Buzón asíncronos, progreso por tramo, resistir recargas): mejora futura; hoy es solo frontend.
- Quedan ~10 avisos con íconos o botones dentro sin migrar a `Alert` y algunos textos antiguos en «tú» sin revisar.
- Los errores de carga de datos siguen en línea; si en el futuro se quiere una forma única de «no se pudo cargar» con
  reintento, es un componente aparte (no una alerta).
