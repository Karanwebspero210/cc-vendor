# syntax=docker/dockerfile:1
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install OS deps (optional)
RUN apk add --no-cache tini

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy app source
COPY . .

# Set environment
ENV NODE_ENV=production \
    PORT=5000

# Expose port
EXPOSE 5000

# Use Tini as init to handle signals properly
ENTRYPOINT ["/sbin/tini", "--"]

# Start the app
CMD ["node", "src/app.js"]
