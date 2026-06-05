# Stage 1: Build the Go application binary
FROM golang:1.23-alpine AS builder

WORKDIR /app

# Copy the module files and download dependencies
COPY go.mod ./
RUN go mod download

# Copy the entire source tree (including embedded static assets)
COPY . .

# Compile Go application as a statically linked binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o webhook_tester main.go

# Stage 2: Create a minimal runner container
FROM alpine:latest  

RUN apk --no-cache add ca-certificates

WORKDIR /root/

# Copy the compiled binary from the builder stage
COPY --from=builder /app/webhook_tester .

# Expose our unique fallback port
EXPOSE 8345

# Start the Webhook Tester server
CMD ["./webhook_tester"]
