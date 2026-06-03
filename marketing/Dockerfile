# Marketing SPA (Vite + Nginx). Mirrors frontend/Dockerfile (static serve),
# NOT landing/ (Next.js SSR).

# Build stage
FROM node:18-alpine AS build
WORKDIR /app

# Vite build-time env (baked into the bundle). marketing axios appends
# /marketing → ${VITE_API_URL}/marketing/*.
ARG VITE_API_URL
ARG VITE_API_BASE_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
ENV NODE_ENV=production
RUN npm run build

# Production stage with Nginx
FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
