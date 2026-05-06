# Payloads API: Documents y Sale Note (Frontend → Tenant API)

Este archivo documenta los payloads (claves y estructura) que debe enviar el frontend a los endpoints:

- `POST /api/documents` → `Tenant\Api\DocumentController@store`
- `POST /api/sale-note` → `Tenant\Api\SaleNoteController@store`

Incluye ejemplos listos para copiar/pegar con los **campos exactos** que el backend espera procesar según la lógica actual.

---

## 1) `POST /api/documents` (CPE: Factura/Boleta/Nota Crédito/Débito)

### 1.1 Reglas importantes (items/productos)

- Este endpoint usa un pipeline interno de **transformación y validación** para API.
- Cada ítem se identifica por `codigo_interno` (internal_id).
- Si el producto **no existe** en `tenant.items`, el backend lo **crea automáticamente**.
- Si el producto **existe**, el backend puede **actualizar la descripción** del producto si `actualizar_descripcion` es `true` (por defecto suele ser `true` si se envía desde API).

### 1.2 Ejemplo: Factura (01) gravada en PEN con 1 ítem

```json
{
  "serie_documento": "F001",
  "numero_documento": 123,
  "fecha_de_emision": "2026-04-14",
  "hora_de_emision": "12:00:00",

  "codigo_tipo_documento": "01",
  "codigo_tipo_moneda": "PEN",
  "factor_tipo_de_cambio": 1,
  "codigo_tipo_operacion": "0101",
  "fecha_de_vencimiento": "2026-04-14",

  "datos_del_cliente_o_receptor": {
    "codigo_tipo_documento_identidad": "6",
    "numero_documento": "20123456789",
    "apellidos_y_nombres_o_razon_social": "CLIENTE S.A.C.",
    "nombre_comercial": "",
    "codigo_pais": "PE",
    "ubigeo": "150101",
    "direccion": "AV. DEMO 123",
    "correo_electronico": "facturacion@cliente.com",
    "telefono": "999999999",
    "codigo_tipo_direccion": null
  },

  "totales": {
    "total_anticipos": 0,
    "total_descuentos": 0,
    "total_cargos": 0,
    "total_exportacion": 0,
    "total_operaciones_gratuitas": 0,
    "total_operaciones_gravadas": 84.75,
    "total_operaciones_inafectas": 0,
    "total_operaciones_exoneradas": 0,
    "total_igv": 15.25,
    "total_igv_operaciones_gratuitas": 0,
    "total_base_isc": 0,
    "total_isc": 0,
    "total_base_otros_impuestos": 0,
    "total_otros_impuestos": 0,
    "total_impuestos_bolsa_plastica": 0,
    "total_impuestos": 15.25,
    "total_valor": 84.75,
    "subtotal_venta": 100.0,
    "total_venta": 100.0,
    "total_pendiente_pago": 0
  },

  "items": [
    {
      "codigo_interno": "SKU-001",
      "descripcion": "PRODUCTO DE PRUEBA",
      "nombre": null,
      "nombre_secundario": null,

      "codigo_tipo_item": "01",
      "codigo_producto_sunat": "90",
      "codigo_producto_gsl": null,

      "unidad_de_medida": "NIU",
      "cantidad": 1,

      "valor_unitario": 84.75,
      "codigo_tipo_precio": "01",
      "precio_unitario": 100.0,

      "codigo_tipo_afectacion_igv": "10",
      "total_base_igv": 84.75,
      "porcentaje_igv": 18,
      "total_igv": 15.25,

      "codigo_tipo_sistema_isc": null,
      "total_base_isc": 0,
      "porcentaje_isc": 0,
      "total_isc": 0,

      "total_base_otros_impuestos": 0,
      "porcentaje_otros_impuestos": 0,
      "total_otros_impuestos": 0,
      "total_impuestos_bolsa_plastica": 0,

      "total_impuestos": 15.25,
      "total_valor_item": 84.75,
      "total_cargos": 0,
      "total_descuentos": 0,
      "total_item": 100.0,

      "datos_adicionales": [],
      "descuentos": [],
      "cargos": [],
      "informacion_adicional": null,
      "lots": [],
      "actualizar_descripcion": true,
      "nombre_producto_pdf": null,
      "nombre_producto_xml": null,
      "dato_adicional": null,
      "esFusionado": false
    }
  ],

  "leyendas": [
    { "codigo": "1000", "valor": "CIEN Y 00/100 SOLES" }
  ],

  "acciones": {
    "enviar_email": false,
    "enviar_xml_firmado": true,
    "formato_pdf": "a4"
  }
}
```

### 1.3 Nota de crédito (07) – anulación (referencia por `external_id`)

```json
{
  "serie_documento": "FC01",
  "numero_documento": "#",
  "fecha_de_emision": "2026-04-14",
  "hora_de_emision": "12:00:00",
  "codigo_tipo_documento": "07",
  "codigo_tipo_moneda": "PEN",

  "datos_del_cliente_o_receptor": {
    "codigo_tipo_documento_identidad": "6",
    "numero_documento": "20123456789",
    "apellidos_y_nombres_o_razon_social": "CLIENTE S.A.C.",
    "codigo_pais": "PE",
    "ubigeo": "150101",
    "direccion": "AV. DEMO 123",
    "correo_electronico": "facturacion@cliente.com",
    "telefono": "999999999",
    "codigo_tipo_direccion": null
  },

  "documento_afectado": {
    "external_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  },

  "codigo_tipo_nota": "01",
  "motivo_o_sustento_de_nota": "Anulación total de la operación",

  "totales": {
    "total_operaciones_gravadas": 84.75,
    "total_igv": 15.25,
    "total_impuestos": 15.25,
    "total_valor": 84.75,
    "total_venta": 100.0
  },

  "items": [
    {
      "codigo_interno": "SKU-001",
      "descripcion": "ANULACIÓN - ITEM 1",
      "codigo_tipo_item": "01",
      "codigo_producto_sunat": "90",
      "unidad_de_medida": "NIU",
      "cantidad": 1,
      "valor_unitario": 84.75,
      "codigo_tipo_precio": "01",
      "precio_unitario": 100.0,
      "codigo_tipo_afectacion_igv": "10",
      "total_base_igv": 84.75,
      "porcentaje_igv": 18,
      "total_igv": 15.25,
      "total_impuestos": 15.25,
      "total_valor_item": 84.75,
      "total_item": 100.0,
      "actualizar_descripcion": true
    }
  ],

  "leyendas": [
    { "codigo": "1000", "valor": "CIEN Y 00/100 SOLES" }
  ],

  "acciones": {
    "enviar_email": false,
    "enviar_xml_firmado": true,
    "formato_pdf": "a4"
  }
}
```

---

## 2) `POST /api/sale-note` (Nota de venta)

### 2.1 Reglas importantes (items/productos)

- Este endpoint guarda `SaleNote` con `updateOrCreate` (puede crear o actualizar cabecera).
- El detalle se guarda en `sale_note_items` y la “actualización” depende de `items[].id` (ID del **SaleNoteItem**). Para crear nuevos, envía `null`.
- Para crear productos automáticamente debes enviar `force_create_if_not_exist: true` y proveer datos suficientes por ítem.
  - Si envías `full_item`, el backend intenta encontrar un item “idéntico” por un conjunto de campos y si no existe lo crea.
  - Si no envías `full_item`, busca por `internal_id` y si no existe lo crea.
- Si `force_create_if_not_exist: false`, el backend asume que el producto ya existe y que `item_id` es válido.

### 2.2 Ejemplo: Nota de venta normal (productos ya existen)

```json
{
  "id": null,
  "series_id": 1,
  "number": null,

  "date_of_issue": "2026-04-14",
  "time_of_issue": "12:00:00",

  "customer_id": 10,
  "establishment_id": 1,

  "currency_type_id": "PEN",
  "exchange_rate_sale": 1,

  "type_period": null,
  "quantity_period": 0,

  "total_prepayment": 0,
  "total_discount": 0,
  "total_charge": 0,
  "total_exportation": 0,
  "total_free": 0,
  "total_taxed": 84.75,
  "total_unaffected": 0,
  "total_exonerated": 0,
  "total_igv": 15.25,
  "total_base_isc": 0,
  "total_isc": 0,
  "total_base_other_taxes": 0,
  "total_other_taxes": 0,
  "total_plastic_bag_taxes": 0,
  "total_taxes": 15.25,
  "total_value": 84.75,
  "total": 100.0,

  "items": [
    {
      "id": null,
      "item_id": 123,
      "item": {
        "id": 123,
        "description": "PRODUCTO DE PRUEBA",
        "unit_type_id": "NIU",
        "has_igv": true
      },

      "quantity": 1,
      "unit_value": 84.75,

      "affectation_igv_type_id": "10",
      "total_base_igv": 84.75,
      "percentage_igv": 18,
      "total_igv": 15.25,

      "system_isc_type_id": null,
      "total_base_isc": 0,
      "percentage_isc": 0,
      "total_isc": 0,

      "total_base_other_taxes": 0,
      "percentage_other_taxes": 0,
      "total_other_taxes": 0,
      "total_plastic_bag_taxes": 0,

      "total_taxes": 15.25,
      "price_type_id": "01",
      "unit_price": 100.0,

      "total_value": 84.75,
      "total_charge": 0,
      "total_discount": 0,
      "total": 100.0,

      "attributes": [],
      "charges": [],
      "discounts": [],
      "warehouse_id": null,
      "additional_information": null,
      "name_product_pdf": null
    }
  ],

  "payments": [],
  "force_create_if_not_exist": false
}
```

### 2.3 Ejemplo: Nota de venta con autocreación de cliente y/o productos

```json
{
  "id": null,
  "series_id": 1,
  "number": null,

  "date_of_issue": "2026-04-14",
  "time_of_issue": "12:00:00",

  "customer_id": 0,
  "datos_del_cliente_o_receptor": {
    "codigo_tipo_documento_identidad": "6",
    "numero_documento": "20123456789",
    "apellidos_y_nombres_o_razon_social": "CLIENTE S.A.C.",
    "codigo_pais": "PE",
    "ubigeo": "150101",
    "direccion": "AV. DEMO 123",
    "correo_electronico": "facturacion@cliente.com",
    "telefono": "999999999"
  },

  "establishment_id": 1,
  "currency_type_id": "PEN",
  "exchange_rate_sale": 1,

  "type_period": null,
  "quantity_period": 0,

  "total_taxed": 84.75,
  "total_igv": 15.25,
  "total_taxes": 15.25,
  "total_value": 84.75,
  "total": 100.0,

  "items": [
    {
      "internal_id": "SKU-NEW-001",
      "description": "PRODUCTO NUEVO",
      "unit_type_id": "NIU",
      "currency_type_id": "PEN",
      "unit_price": 100.0,
      "unit_value": 84.75,
      "quantity": 1,
      "affectation_igv_type_id": "10",
      "total_base_igv": 84.75,
      "percentage_igv": 18,
      "total_igv": 15.25,
      "total_taxes": 15.25,
      "total_value": 84.75,
      "total": 100.0,
      "price_type_id": "01",
      "item": {
        "description": "PRODUCTO NUEVO",
        "unit_type_id": "NIU",
        "has_igv": true
      }
    }
  ],

  "payments": [],
  "force_create_if_not_exist": true
}
```

---

## 3) Notas sobre valores que dependen de tu BD

Hay valores que deben salir de tablas internas y por eso el frontend debe obtenerlos previamente:

- `series_id` (sale-note): depende de la tabla `series` del tenant para el tipo correspondiente.
- `establishment_id`: depende del usuario/establecimiento.
- `customer_id`: depende del `person` creado/seleccionado.

Este archivo define el **formato exacto de claves y estructura**, pero los IDs concretos (`series_id`, `customer_id`, `item_id`) deben ser válidos en tu tenant.

