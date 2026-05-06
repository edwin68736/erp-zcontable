{
  "series_id": 1,
  "date_of_issue": "2026-03-24",
  "time_of_issue": "12:00:00",
  "codigo_tipo_moneda": "PEN",
  "exchange_rate_sale": 1,
  "force_create_if_not_exist": true,
  "datos_del_cliente_o_receptor": {
    "codigo_tipo_documento_identidad": "1",
    "numero_documento": "12345678",
    "apellidos_y_nombres_o_razon_social": "Juan Perez",
    "codigo_pais": "PE",
    "ubigeo": "150101",
    "direccion": "Av. Siempre Viva 742",
    "correo_electronico": "juan@example.com",
    "telefono": "999888777"
  },
  "type_period": null,
  "quantity_period": 0,
  "items": [
    {
      "internal_id": "SKU-001",
      "quantity": 2,
      "unit_value": 10.0,
      "price_type_id": "01",
      "unit_price": 11.8,
      "affectation_igv_type_id": "10",
      "total_base_igv": 20.0,
      "percentage_igv": 18,
      "total_igv": 3.6,
      "total_taxes": 3.6,
      "total_value": 20.0,
      "total_charge": 0,
      "total_discount": 0,
      "total": 23.6,
      "item": {
        "description": "Producto A",
        "unit_type_id": "NIU",
        "lots": [],
        "presentation": { "quantity_unit": 1 },
        "IdLoteSelected": null
      }
    },
    {
      "full_item": {
        "description": "Producto manual B",
        "unit_type_id": "NIU",
        "sale_unit_price": 5.9,
        "sale_affectation_igv_type_id": "10",
        "purchase_affectation_igv_type_id": "10"
      },
      "quantity": 1,
      "unit_value": 5.0,
      "price_type_id": "01",
      "unit_price": 5.9,
      "affectation_igv_type_id": "10",
      "total_base_igv": 5.0,
      "percentage_igv": 18,
      "total_igv": 0.9,
      "total_taxes": 0.9,
      "total_value": 5.0,
      "total_charge": 0,
      "total_discount": 0,
      "total": 5.9,
      "item": {
        "description": "Producto manual B",
        "unit_type_id": "NIU",
        "lots": [],
        "presentation": { "quantity_unit": 1 },
        "IdLoteSelected": null
      }
    }
  ],
  "payments": [
    {
      "date_of_payment": "2026-03-24",
      "payment_method_type_id": "01",
      "payment_destination_id": "cash",
      "reference": "Caja Principal",
      "payment": 29.5,
      "payment_received": 29.5
    }
  ]
}
