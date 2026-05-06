# Frontend — ERP ZContable

Interfaz web del ERP para **ZContable** (estudio contable). Stack: **React** + **Vite**.

## Scripts

```bash
npm install
npm run dev    # desarrollo con HMR
npm run build  # build de producción
npm run preview
```

El despliegue en contenedor usa el `Dockerfile` de esta carpeta; el proxy público y HTTPS los gestiona Traefik en la raíz del monorepo (`docker-compose.yml`).
