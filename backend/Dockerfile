# Modeled on the monorepo backend Dockerfile, pruned to what the marketing
# service needs (no cairo/pdf/native deps — only openssl for Prisma).
FROM node:20 AS development

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the application for the production stage
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start:dev"]

# Production stage
FROM node:20 AS production

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=development /app/dist ./dist
COPY --from=development /app/prisma ./prisma
COPY --from=development /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=development /app/node_modules/@prisma/client ./node_modules/@prisma/client
# Handlebars email templates (EmailService resolves templates/ from cwd).
COPY --from=development /app/templates ./templates

RUN mkdir -p logs && chown -R node:node /app/logs

USER node

EXPOSE 3000

CMD ["node", "dist/main"]
