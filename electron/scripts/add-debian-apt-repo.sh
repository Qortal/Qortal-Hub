#!/bin/bash

# Debian postinst for Qortal Hub. dpkg runs this as root while it (and apt, when installing
# through apt) holds the package locks, so it must not call sudo or apt-get: a nested apt-get
# can never get the lock. Repository setup below is best effort and never fails the install.
# electron-builder fills dollar-brace placeholders in this file, so shell variables avoid braces.

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

# 0.5.x installs added an apt source on update.qortal-hub.org, which no longer resolves,
# so every apt update warned. Remove it if that is what it points at.
legacy_list=/etc/apt/sources.list.d/qortal-hub.list
if [ -f "$legacy_list" ] && grep -q 'update\.qortal-hub\.org' "$legacy_list"; then
  rm -f "$legacy_list" /usr/share/keyrings/qortal-hub.gpg
fi

# Add the Qortal Hub apt repository so updates arrive through apt.
add_qortal_apt_repo() {
  key_url=https://hubdeb.qortal.org/qortal-hub.gpg
  key_file=/etc/apt/keyrings/qortal-hub.gpg
  command -v gpg >/dev/null 2>&1 || return 1
  tmp=$(mktemp) || return 1
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$key_url" -o "$tmp"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp" "$key_url"
  else
    false
  fi && mkdir -p /etc/apt/keyrings \
    && gpg --batch --yes --dearmor -o "$key_file" "$tmp" \
    && chmod 644 "$key_file" \
    && echo "deb [signed-by=$key_file] https://hubdeb.qortal.org ./" > /etc/apt/sources.list.d/qortal.list
  status=$?
  rm -f "$tmp"
  return $status
}

if [ ! -f /etc/apt/sources.list.d/qortal.list ]; then
  if add_qortal_apt_repo; then
    echo "Qortal Hub: added the hubdeb.qortal.org apt repository; it is used from the next apt update."
  else
    echo "Qortal Hub: could not add the apt repository (needs curl or wget, plus gpg). The app is installed; updates will not arrive through apt." >&2
  fi
fi

exit 0
