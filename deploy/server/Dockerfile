# Build the app with npm run build before packaging a release.
# The production bundle is deliberately separate from source and secret files.
ARG API_BASE_IMAGE=mcr.microsoft.com/playwright:v1.61.1-noble
ARG WEB_BASE_IMAGE=nginx:1.30-alpine
FROM ${API_BASE_IMAGE} AS api
USER root
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server-dist ./server-dist
COPY vendor ./vendor
COPY database/schema.sql ./database/schema.sql
COPY deploy/server/migrate-legacy.mjs deploy/server/migration-values.mjs ./deploy/server/
USER pwuser
EXPOSE 3000
CMD ["node", "server-dist/index.js"]

FROM api AS migration
USER root
RUN npm install --no-save --package-lock=false --omit=dev --ignore-scripts mysql2@3.23.3 && npm cache clean --force
USER pwuser
CMD ["node", "deploy/server/migrate-legacy.mjs"]

FROM ${WEB_BASE_IMAGE} AS web
COPY dist /usr/share/nginx/html
COPY deploy/server/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
