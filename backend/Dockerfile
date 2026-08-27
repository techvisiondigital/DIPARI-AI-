FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app

# @napi-rs/canvas renders text with fonts found on the host, and it bundles
# none of its own. node:20-alpine ships with NO fonts at all, so every
# ctx.fillText() silently drew nothing: generated ad banners came out with the
# layout frame but an empty headline, an unlabelled CTA button and a blank
# contact bar. DejaVu covers Latin text; Noto covers the rest.
# fontconfig is what lets the renderer enumerate them.
RUN apk add --no-cache fontconfig font-dejavu font-noto \
    && fc-cache -f \
    && fc-list | head -5

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

EXPOSE 3001
CMD ["npm", "run", "start:prod"]
