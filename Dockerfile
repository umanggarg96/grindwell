FROM node:22-alpine

WORKDIR /app

COPY package.json server.js ./
COPY public ./public

ENV PORT=3000
ENV DATA_FILE=/data/data.json

EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "server.js"]
