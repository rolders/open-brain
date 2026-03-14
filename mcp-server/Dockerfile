FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY *.js ./

USER node

CMD ["node", "index.js"]
