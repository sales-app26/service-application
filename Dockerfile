# ---- deps: install all deps (incl. dev) for build ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TypeScript (copies database/sql into dist) ----
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod-deps: install only production deps ----
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runner: minimal final image ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# "Today", weeks and months are India time. The code converts explicitly
# (src/common/utils/ist-time.util.ts); this keeps logs and any bare Date in step.
ENV TZ=Asia/Kolkata
# Fonts: the visit-photo stamp is rendered by sharp/librsvg and needs a font,
# or the text on the photo comes out as empty boxes.
RUN apk add --no-cache tzdata fontconfig font-dejavu
RUN addgroup -S nodejs && adduser -S nestjs -G nodejs

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER nestjs

# Railway injects PORT at runtime; the app reads it (default 4100).
EXPOSE 4100

CMD ["node", "dist/main.js"]
