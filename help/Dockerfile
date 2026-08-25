# HummyTummy documentation portal (Nextra) — standalone Next build.
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# The canonical and hreflang tags in theme.config.tsx are baked into the
# statically generated pages, so this has to be a BUILD arg — setting it only in
# the container environment leaves the SSG pages on the fallback literal while
# /sitemap.xml and /robots.txt (which are request-time routes) use the runtime
# value. A staging deploy would then advertise staging URLs in its sitemap and
# production URLs in every canonical tag, which is worse than either alone.
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Next standalone server (listens on PORT || 3000). Mapped to host 3201 (prod) /
# 3203 (staging) in compose; the container always listens on 3000.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
