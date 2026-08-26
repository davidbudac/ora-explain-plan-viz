FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG APP_BASE_PATH=/
ENV APP_BASE_PATH=$APP_BASE_PATH

# Optional: build the UI with the local DB-connect agent integration enabled.
ARG VITE_ENABLE_DB_AGENT=
ENV VITE_ENABLE_DB_AGENT=$VITE_ENABLE_DB_AGENT

RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
