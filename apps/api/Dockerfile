FROM golang:1.23-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download

COPY apps/api/ .

RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /opsradar-api .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates

# Install bob CLI (Bob Shell)
RUN apk add --no-cache curl && \
    curl -fsSL https://raw.githubusercontent.com/ibm/bob-shell/main/install.sh | sh || true

WORKDIR /app
COPY --from=builder /opsradar-api .

EXPOSE 8080
ENTRYPOINT ["/app/opsradar-api"]
