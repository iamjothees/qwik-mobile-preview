# Lightweight Node.js Alpine base
FROM node:22-alpine

WORKDIR /app

# Copy dependency definition
COPY server/package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --no-audit --no-fund

# Copy source code and public web assets
COPY server/src/ ./src/

# Expose server port
EXPOSE 4567

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4567/api/status || exit 1

# Start relay server
CMD ["node", "src/server.js"]
