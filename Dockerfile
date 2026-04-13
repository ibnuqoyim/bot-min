FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy source
COPY . .

# Session data persisted via volume mount at /app/session
ENV WA_SESSION_PATH=/app/session

CMD ["node", "--import", "tsx/esm", "index.ts"]
