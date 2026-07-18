FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
# tsx runs the TS server directly; it's a devDependency, so add it after the prod install
RUN npm ci --omit=dev && npm install --no-save tsx
COPY src ./src
COPY migrations ./migrations
COPY dist ./dist
ENV NODE_ENV=production
CMD ["npx", "tsx", "src/index.ts"]
