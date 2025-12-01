FROM node:20-alpine

WORKDIR /app

# Install Python and dependencies for Spark interaction
RUN apk add --no-cache python3 py3-pip openjdk11-jre

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p /app/logs /app/models

# Expose ports
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node healthcheck.js || exit 1

# Start the application
CMD ["node", "index.js"]
