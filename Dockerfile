FROM node:20-alpine

RUN apk add --no-cache openssl

# Set working directory
WORKDIR /app

# Install dependencies first (for better caching)
COPY package*.json ./
RUN npm install --production

# Copy application source code
COPY . .

# Local development certificate for localhost and 127.0.0.1.
RUN mkdir -p /app/certs \
    && openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
       -keyout /app/certs/localhost-key.pem \
       -out /app/certs/localhost-cert.pem \
       -subj "/CN=localhost" \
       -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    && chmod 600 /app/certs/localhost-key.pem

# Expose server port
EXPOSE 8000

# Start the application
CMD ["npm", "start"]
