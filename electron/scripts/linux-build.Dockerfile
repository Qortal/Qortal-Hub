# Debian 11 (bullseye) ~glibc 2.31 — same compatibility class as Ubuntu 20.04, without PPAs.
# Ubuntu 20.04 focal is EOL; deadsnakes often stops publishing for it, breaking apt installs.
# Python 3.9 + libpython come from Debian main. For local Linux Docker package builds only; CI stays ubuntu-22.04.
FROM debian:bullseye-slim

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=UTC

# python3-dev pulls libpython3.9-dev (PyInstaller); python3 pulls libpython3.9-stdlib (.so runtime).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gnupg \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    fakeroot \
    dpkg-dev \
    rpm \
    squashfs-tools \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
