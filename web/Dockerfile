FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_KEY
ENV VITE_API_KEY=$VITE_API_KEY
RUN npm run build

# Caddy serves the dashboard, proxies the API and handles HTTPS certificates.
FROM caddy:2.10-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
