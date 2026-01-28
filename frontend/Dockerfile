FROM node:18 AS development

WORKDIR /app

COPY package.json ./
RUN npm install --legacy-peer-deps

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]

# Production build stage
FROM node:18-alpine AS build

WORKDIR /app

# Accept build arguments for environment variables
ARG VITE_API_URL
ARG VITE_API_BASE_URL
ARG VITE_SOCKET_URL
ARG VITE_WS_URL
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_APP_VERSION
ARG VITE_BUILD_TIME
ARG VITE_COMMIT_SHA
# Sentry build args for source map upload
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT_FRONTEND

# Set environment variables for build
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_BUILD_TIME=$VITE_BUILD_TIME
ENV VITE_COMMIT_SHA=$VITE_COMMIT_SHA
# Sentry environment variables for source map upload during build
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT_FRONTEND=$SENTRY_PROJECT_FRONTEND
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

# Production stage with Nginx
FROM nginx:alpine AS production

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
