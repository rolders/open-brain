FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --production

COPY *.js ./

USER node

CMD ["node", "index.js"]
