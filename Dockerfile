# VITA co-op relay (zero-dependency, Node stdlib only)
# Build:  docker build -t vita-relay .
# Run:    docker run --rm -p 8080:8080 -e PORT=8080 vita-relay
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Hanya server relay yang dibutuhkan — tanpa `npm install` (nol dependency).
COPY tools/relay.mjs ./tools/relay.mjs

# Least privilege: jalankan sebagai user non-root bawaan image.
USER node

EXPOSE 8080

CMD ["node", "tools/relay.mjs"]
