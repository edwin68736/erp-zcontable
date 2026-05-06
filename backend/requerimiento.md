DOCUMENTO DE REQUERIMIENTOS – MÓDULO FINANCIERO ERP
Este documento detalla los requerimientos funcionales y técnicos del módulo financiero inicial del nuevo sistema ERP del estudio contable. Este sistema será independiente de Tukifac, pero se integrará con él únicamente para sincronizar documentos electrónicos.
1. OBJETIVO DEL MÓDULO
El módulo permitirá gestionar cuentas por cobrar, pagos, saldos de clientes, ingresos del estudio y estados de cuenta. Servirá como base del core financiero del ERP.
2. INTEGRACIÓN CON TUKIFAC
El sistema se conectará mediante API a Tukifac para consultar documentos electrónicos emitidos. No almacenará la factura completa, solo su referencia financiera.
Datos sincronizados desde Tukifac:
• ID del documento (requerido)
• Tipo de comprobante (requerido)
• Número de documento (requerido)
• Fecha de emisión (requerido)
• Monto total (requerido)
• Estado del documento (requerido)
3. GESTIÓN DE CLIENTES / EMPRESAS
Campos requeridos:
• RUC
• Razón social
• Código interno del estudio
• Estado del cliente
Campos opcionales:
• Nombre comercial
• Dirección
• Teléfono
• Correo electrónico
• Fecha de inicio de servicio
4. CONTACTOS RESPONSABLES POR EMPRESA
Cada empresa podrá registrar uno o varios contactos responsables para la comunicación con el estudio.
Campos requeridos:
• Nombre completo
• Cargo en la empresa
• Teléfono o celular
• Correo electrónico
Campos opcionales:
• Observaciones
• Prioridad de contacto
5. FUNCIONALIDADES FINANCIERAS
• Sincronizar facturas desde Tukifac
• Registrar cargos manuales
• Registrar pagos manuales
• Adjuntar comprobantes
• Calcular saldos automáticamente
• Generar estados de cuenta
• Historial financiero por cliente
6. CONFIGURACIÓN DEL ESTUDIO
El sistema contará con un panel de configuración del estudio.
Campos configurables:
• Nombre del estudio (requerido)
• RUC del estudio (requerido)
• Dirección (requerido)
• Teléfono (opcional)
• Correo institucional (opcional)
• Logo del estudio (opcional)
7. ROLES Y PERMISOS
El sistema incluirá gestión de usuarios con control de acceso por roles.
Roles sugeridos:
• Administrador
• Supervisor
• Contador
• Asistente
Permisos configurables:
• Ver clientes
• Registrar pagos
• Sincronizar facturas
• Generar reportes
• Configurar el sistema
8. VISTAS DEL SISTEMA (ESTIMADAS)
• Dashboard financiero
• Gestión de clientes
• Contactos por empresa
• Estado de cuenta del cliente
• Registro de pagos
• Reportes financieros
• Configuración del estudio
• Gestión de usuarios y roles

9. ASIGNACIÓN DE EQUIPO CONTABLE POR EMPRESA

En el estudio contable, cada empresa cliente será atendida por un equipo contable asignado.

Este equipo estará conformado por:

Supervisor contable

Asistente contable

Contador general (opcional según la organización)

Al momento de registrar o editar una empresa en el sistema, se deberá poder asignar el equipo contable responsable de su gestión.

Campos de asignación

Supervisor contable (usuario del sistema)

Asistente contable (usuario del sistema)

Contador general responsable (opcional)

Reglas del sistema

Un usuario puede estar asignado a múltiples empresas.

Cada empresa debe tener al menos un supervisor asignado.

La asignación podrá modificarse en cualquier momento por un administrador.

Beneficios de esta estructura

Esto permitirá:

Controlar qué usuarios pueden acceder a cada empresa

Organizar el trabajo del estudio

Tener responsables claros por cliente

Facilitar seguimiento y control de cuentas por cobrar

10. CONTROL DE ACCESO POR EMPRESAS ASIGNADAS

El sistema deberá implementar restricción de acceso por empresa asignada.

Esto significa que los usuarios del sistema solo podrán visualizar y gestionar información de las empresas que tengan asignadas.

Reglas de acceso

Administrador

Acceso total a todas las empresas

Puede asignar equipos contables

Puede gestionar usuarios

Supervisor

Puede ver todas las empresas que tiene asignadas

Puede registrar pagos

Puede revisar estados de cuenta

Puede generar reportes de sus empresas

Asistente

Solo puede ver las empresas asignadas

Puede registrar pagos

Puede adjuntar comprobantes

Puede registrar observaciones

Contador

Puede revisar información financiera

Puede generar reportes

Puede ver historial de clientes

11. GESTIÓN COMPLETA DE USUARIOS

El sistema deberá incluir un módulo completo de gestión de usuarios del sistema.

Funcionalidades

Crear usuarios

Editar usuarios

Activar / desactivar usuarios

Asignar roles

Asignar empresas

Cambiar contraseñas

Restablecer contraseñas

Campos del usuario

Campos requeridos:

Nombre completo

Correo electrónico

Rol del usuario

Estado (activo / inactivo)

Campos opcionales:

Teléfono

Cargo

Foto de perfil

Relación usuario - empresa

Se implementará una relación muchos a muchos entre:

Usuarios

Empresas

Esto permitirá que:

Un usuario gestione varias empresas

Una empresa tenga varios usuarios asignados

12. SEGUIMIENTO DE CUENTAS POR COBRAR

El sistema deberá permitir el seguimiento de facturas emitidas a los clientes del estudio.

Cada empresa podrá tener facturas pendientes de pago correspondientes a los servicios contables.

Flujo del proceso

Se sincroniza la factura desde Tukifac

Se registra como cuenta por cobrar

Se muestra en el estado de cuenta del cliente

Se registran pagos parciales o totales

El sistema actualiza automáticamente el saldo

Estados posibles de la factura

Pendiente

Parcialmente pagado

Pagado

Anulado

Información mostrada

Número de documento

Fecha de emisión

Monto total

Pagos registrados

Saldo pendiente

13. HISTORIAL FINANCIERO POR EMPRESA

Cada empresa tendrá un historial financiero completo.

Este historial mostrará:

Facturas emitidas

Pagos realizados

Ajustes manuales

Cargos adicionales

Saldo total

Esto permitirá tener una visión clara del estado financiero del cliente con el estudio contable.

1️⃣ Recordatorios automáticos de pago

correo

whatsapp

notificaciones internas

2️⃣ Alertas de deuda vencida
