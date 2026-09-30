FROM node:22-slim

WORKDIR /migration
COPY package.json .
RUN npm install

COPY . .
CMD ["node", "migrer.js"]
