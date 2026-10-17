FROM node:22

WORKDIR /app

# Invalida caché de build cuando cambia el commit (deploy pasa BUILD_COMMIT).
ARG BUILD_COMMIT=dev
RUN echo "build commit: ${BUILD_COMMIT}"

COPY package.json package-lock.json* ./

RUN npm install

COPY . .

# PWA "ZContable" instalable en producción (este Dockerfile es el del VPS de producción): ver vite.config.ts,
# public/manifest.json y public/sw.js. Pruebas arma su propia variante "Demo" en scripts/deploy-staging.sh.
ENV VITE_ENABLE_PWA=1

RUN npm run build

RUN npm install -g serve

EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "3000"]