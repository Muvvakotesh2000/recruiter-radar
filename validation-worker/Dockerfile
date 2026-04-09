FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001

# Default: run API. Override CMD to run workers:
#   docker run ... node dist/worker.js
CMD ["node", "dist/index.js"]
