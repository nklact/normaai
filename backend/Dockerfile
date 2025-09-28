# Use the latest Rust image
FROM rust:latest as builder

# Create app directory
WORKDIR /app

# Copy dependency files first for layer caching
COPY Cargo.toml Cargo.lock ./
RUN cargo fetch

# Copy source code
COPY src ./src

# Build the application
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

# Install CA certificates for HTTPS requests
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy the binary from builder stage
COPY --from=builder /app/target/release/norma-ai-backend /app/

# Expose port
EXPOSE 8080

# Run the binary
CMD ["./norma-ai-backend"]