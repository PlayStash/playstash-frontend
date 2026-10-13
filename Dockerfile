# Stage 1
FROM node:lts-alpine AS build
WORKDIR /build
RUN apk add --no-cache openjdk21-jre-headless && npm install -g pnpm@11.25.0
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

# Stage 2
FROM nginx:stable-alpine AS run
RUN apk upgrade --no-cache && rm -rf /usr/share/nginx/html/*
COPY --from=build /build/deployment/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
