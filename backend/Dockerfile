FROM node:20 AS development

# Install dependencies for Prisma, PDF generation, and native modules
RUN apt-get update && apt-get install -y \
    openssl \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the application for production stage
RUN npm run build

# Create directories for file storage
RUN mkdir -p storage/invoices
RUN mkdir -p src/modules/subscriptions/templates/emails

EXPOSE 3000

CMD ["npm", "run", "start:dev"]

# Production stage
FROM node:20 AS production

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    openssl \
    libcairo2 \
    libpango-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    libpixman-1-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY --from=development /app/dist ./dist
COPY --from=development /app/prisma ./prisma
COPY --from=development /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=development /app/src/modules/subscriptions/templates ./src/modules/subscriptions/templates
COPY --from=development /app/templates ./templates

# Create storage and logs directories
RUN mkdir -p storage/invoices
RUN mkdir -p uploads
RUN mkdir -p logs

# Set permissions
RUN chown -R node:node /app/storage /app/uploads /app/logs

USER node

EXPOSE 3000

CMD ["node", "dist/main"]
