FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/
RUN addgroup -S greeting && adduser -S greeting -G greeting
USER greeting
EXPOSE 4004
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4004/health || exit 1
CMD ["node", "src/index.js"]
