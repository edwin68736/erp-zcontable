# RH: recibos por honorarios recibidos, leídos en SOL

Estado: implementado el 2026-11-10 (solo lectura). Código: `backend/services/rhe_sol_service.go` (consulta),
`rhe_sol_history.go` (historial), `controllers/rhe_sol_controller.go`, rutas `/api/tools/rh-sol/:companyId/…`;
frontend `pages/tools/rh/RhSolPanel.tsx` (pestaña «Recibos recibidos», la principal) y `RhConfirmPanel.tsx`
(pestaña «Pendientes de confirmación», la API anterior).

## Por qué

La API de la «Plataforma de confirmación del RHE y de la FE» (`api-cpe`, `rhe_service.go`) **no es un registro completo**:
solo devuelve comprobantes pendientes, subsanados, pendientes por reinicio (compras) o disconformes (ventas). Un recibo
normal, ya aceptado, no aparece. La pantalla de SOL sí lista todos.

## Cómo se consulta (descubierto con una empresa real el 2026-11-10)

1. Entrada a SOL con la clave de la empresa (`SunatSolAccessService.Generate`) y `openSolMenu` (igual que ITF, NPD, DAM).
2. Menú SOL → opción **`11.5.1.1.14` «Consulta Receptor»** (Recibo por Honorarios Electrónicos; la `11.5.1.1.13` «Consulta
   Emisor» es la de quien emite). `?action=execute&code=11.5.1.1.14` abre `/ol-ti-itreciboelectronico/cpelec001Alias`.
3. **Búsqueda**: `POST /ol-ti-itreciboelectronico/cpelec001Alias` con `accion=CapturaCriterioConsulatRec1`,
   `tipocomprobante=01;02;03;` (+ `tipocomprobante1=01,02,03`: recibos, notas de crédito, otros ingresos de 4.ª),
   `ruc_emisor`, `num_serie`, `num_comprob` vacíos, `fec_desde` / `fec_hasta` (`dd/mm/aaaa`), `tipoestado=00` (todos).
   **Máximo 1 mes por búsqueda** (el formulario rechaza más de 32 días): el servidor parte el rango en tramos de 31 días.
   Si no hay datos, la página dice «No se han encontrado registros»; un error de SUNAT sale como «Pagina de Error».
4. **Reporte**: con la búsqueda hecha, `POST` a la misma ruta con `accion=descargaConsultaReceptor` entrega TODOS los
   recibos del tramo en un texto separado por `|` (ISO-8859-1), con 16 columnas: fecha de emisión, tipo y número del
   documento, estado, tipo y número de documento del emisor, nombre, tipo de renta, gratuito, **descripción**,
   **observación**, moneda, renta bruta, impuesto a la renta, renta neta, monto pendiente. Es más completo que la
   tabla de la pantalla (que pagina y no trae descripción).
5. Se cierra la sesión de SOL (`sess.close()`).

Medido en real: 88 recibos de 10 meses en ~3 s; un mes con 11 recibos en ~1 s.

## Si SUNAT cambia la pantalla

`parseRheSolReport` valida el encabezado («Fecha de Emisión» y 16 columnas) y falla con detalle técnico
(`respuesta_inesperada`) en vez de devolver datos mal leídos. La búsqueda también valida que la página traiga
«descargaArchivo» o «No se han encontrado registros». Las pruebas (`rhe_sol_service_test.go`) usan un SUNAT simulado con
esta estructura.

## Consulta Emisor (recibos emitidos por personas naturales)

Implementada el 2026-11-10 sobre el mismo servicio (`RheSolService.Query(..., lado, ...)`, `lado=receptor|emisor`). Pestaña
«Recibos emitidos» solo si el RUC empieza con 10. Diferencias con receptor (descubiertas en real con las empresas 176 y 192):

- Opción `11.5.1.1.13`; búsqueda con `accion=CapturaCriterioBusqueda1` y los campos ocultos que trae la pantalla
  (`proceso`, `indicadoralta`; hoy `31196ALTA` / `PNAT`) + `cod_docide=-`, `num_docide` vacío.
- **Hasta 6 meses por búsqueda** (el formulario valida «más de 184 días»): tramos de 180 días.
- Reporte con `accion=descargaConsultaEmisor`: mismas 16 columnas; la contraparte es el «usuario del servicio» (el cliente),
  que se guarda en los campos `emisor_*` (nombres JSON conservados) y la pantalla rotula «Cliente».
- Quien no es emisor electrónico recibe de SUNAT una «Página de Mensajes» con «Ud. no es Emisor Electrónico»: se muestra tal
  cual como error (la «ó» ya viene dañada desde SUNAT y se corrige al leerla).
- El historial se guarda por lado (`rhe_sol_history.lado`, default `receptor`).

## Pendiente

- Las notas de crédito y anulados no suman en los totales de la pantalla; si el estudio necesita otro criterio, se ajusta
  en `totalsByMoneda` (`rhSolUi.ts`).
