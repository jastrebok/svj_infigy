FROM node:20-alpine AS builder
WORKDIR /usr/src/app

COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY public ./public

RUN npm ci
RUN npm run build
RUN mkdir -p /usr/src/app/dist/src/support /usr/src/app/dist/public
RUN cp -R /usr/src/app/src/support /usr/src/app/dist/src/support
RUN cp -R /usr/src/app/public /usr/src/app/dist/public

FROM node:20-alpine
WORKDIR /usr/src/app

COPY package.json package-lock.json ./
COPY --from=builder /usr/src/app/dist ./dist

RUN npm ci --omit=dev

EXPOSE 3000
ENV PORT=3000
CMD ["node", "dist/src/services/server.js"]
