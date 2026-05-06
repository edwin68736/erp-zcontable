# Guía para agentes y desarrollo (miweb)

Resumen del proyecto y reglas de trabajo. Las reglas detalladas para el asistente en Cursor están en [`.cursor/rules/`](.cursor/rules/).

## Stack

| Parte | Ubicación | Tecnología |
|--------|-----------|------------|
| API | Raíz del repo | Go 1.25, Fiber v3, GORM, MySQL |
| Web | `frontend-react/` | React 18, TypeScript, Vite, Tailwind |

## Reglas de implementación

1. **Comprensión**: analizar el flujo actual antes de cambiar código.
2. **Arquitectura**: mantener capas y patrones existentes (controladores → servicios → modelos / páginas → services TS).
3. **SOLID** y separación de responsabilidades; código reutilizable y desacoplado.
4. **Sin duplicar**: comprobar si ya hay endpoint, servicio, hook o componente equivalente.
5. **UI**: coherencia con Tailwind, colores y componentes actuales (véase `layouts/Sidebar.tsx`).
6. **Base de datos**: esquema con GORM `AutoMigrate`; verificar tablas/campos/relaciones antes de alterar modelos.
7. **Integridad**: impacto en otros módulos, roles y acceso por empresa.
8. **Código limpio**: nombres alineados al proyecto; evitar complejidad innecesaria.
9. **Antes de implementar**: breve resumen de lo que hace el módulo y plan de cambios.
10. **Prioridad**: mejorar y extender lo existente antes que sustituir o duplicar.

## Documentación automática

- Reglas Cursor (`.mdc`): `miweb-core.mdc` (siempre), `miweb-backend.mdc` (archivos `.go`), `miweb-frontend.mdc` (`frontend-react`).
