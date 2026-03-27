FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/react/package.json packages/react/
COPY packages/vue/package.json packages/vue/
COPY docs/package.json docs/
RUN npm ci

# Copy source code
COPY packages/core/ packages/core/
COPY docs/ docs/
COPY scripts/ scripts/

# Build core first, then docs
RUN npm run build:core
RUN npm run docs:build

# Serve with docusaurus
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/docs/build ./build
COPY --from=build /app/docs/package.json ./
RUN npm install --production @docusaurus/core@3.9.2
EXPOSE 3000
CMD ["npx", "docusaurus", "serve", "--port", "3000", "--host", "0.0.0.0"]
