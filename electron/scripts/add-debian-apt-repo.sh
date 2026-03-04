#!/bin/bash

# Make necessary config and add Qortal Hub apt repo

# Wrapper without --no-sandbox (proper shebang + quoting)
cat > '/opt/${productFilename}/run-hub' <<'EOF'
#!/bin/sh
exec '/opt/${productFilename}/qortal-hub' "$@"
EOF
chmod +x '/opt/${productFilename}/run-hub'

# Symlink into PATH (so .desktop can call qortal-hub)
ln -sf '/opt/${productFilename}/run-hub' '/usr/bin/${executable}'

# SUID chrome-sandbox for Electron 5+ (no sudo in maintainer scripts)
chown root '/opt/${productFilename}/chrome-sandbox' || true
chmod 4755 '/opt/${productFilename}/chrome-sandbox' || true

update-mime-database /usr/share/mime || true
update-desktop-database /usr/share/applications || true

# Install curl if not installed on the system
if ! which curl; then sudo apt-get --yes install curl; fi

# Install apt repository source list if it does not exist
if [ ! -f /etc/apt/sources.list.d/qortal.list ]; then
  sudo mkdir -p /etc/apt/keyrings && \
  curl -fsSL https://hubdeb.qortal.org/qortal-hub.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/qortal-hub.gpg && \
  echo "deb [signed-by=/etc/apt/keyrings/qortal-hub.gpg] https://hubdeb.qortal.org ./" | sudo tee /etc/apt/sources.list.d/qortal.list && \
  sudo rm -rf /var/lib/apt/lists/* && sudo apt update
fi
