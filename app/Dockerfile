ARG BASE_IMAGE=node:20-alpine
FROM $BASE_IMAGE

WORKDIR /usr/src/app

COPY .npmrc ./
COPY package*.json ./
RUN npm install --omit=dev

COPY app.js ./

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000
CMD ["node", "app.js"]
