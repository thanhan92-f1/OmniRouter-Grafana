FROM cgr.dev/chainguard/node:latest-dev AS deps

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

FROM cgr.dev/chainguard/node:latest

WORKDIR /app

COPY --from=deps /app /app

ENV NODE_ENV=production
ENV EXPORTER_PORT=9208

EXPOSE 9208

CMD ["src/index.js"]
