#!/bin/bash

# Make necessary config and add Qortal Hub apt repo

# SCript to run HUB without sandbox
echo \'/opt/${productFilename}/qortal-hub\' --no-sandbox > '/opt/${productFilename}/run-hub'
chmod +x '/opt/${productFilename}/run-hub'

# Link to run-ui
ln -sf '/opt/${productFilename}/run-hub' '/usr/bin/${executable}'

# SUID chrome-sandbox for Electron 5+
sudo chown root '/opt/${productFilename}/chrome-sandbox' || true
sudo chmod 4755 '/opt/${productFilename}/chrome-sandbox' || true

update-mime-database /usr/share/mime || true
update-desktop-database /usr/share/applications || true

# Install curl if not installed on the system
if ! which curl; then sudo apt-get --yes install curl; fi

# Install apt repository source list if it does not exist
if ! grep ^ /etc/apt/sources.list /etc/apt/sources.list.d/* | grep qortal-hub.list; then
  curl -sS https://update.qortal-hub.org/qortal-hub.gpg | sudo apt-key add -
  sudo rm -rf /usr/share/keyrings/qortal-hub.gpg
  sudo apt-key export E191E7C3 | sudo gpg --dearmour -o /usr/share/keyrings/qortal-hub.gpg
  sudo rm -rf /etc/apt/sources.list.d/qortal-hub.list
  echo 'deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/qortal-hub.gpg] https://update.qortal-hub.org/ ./ ' | sudo tee  /etc/apt/sources.list.d/qortal-hub.list
fi
