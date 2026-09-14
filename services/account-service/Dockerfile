FROM node:20-alpine

WORKDIR /app

# Dependencias de compilacion para el modulo nativo better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
RUN mkdir -p /app/data

EXPOSE 4002

CMD ["node", "src/index.js"]
