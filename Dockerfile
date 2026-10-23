FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies first (for better caching)
COPY package*.json ./
RUN npm install --production

# Copy application source code
COPY . .

# Expose server port
EXPOSE 8000

# Start the application
CMD ["npm", "start"]
