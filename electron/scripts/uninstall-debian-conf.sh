#!/bin/bash

# Remove all conf made by Qortal Hub

# Remove apt repository source list and keyring when user uninstalls app
sudo rm -f /etc/apt/sources.list.d/qortal.list
sudo rm -f /etc/apt/sources.list.d/qortal-hub.list
sudo rm -f /etc/apt/keyrings/qortal-hub.gpg

# Get the root user
if [ $SUDO_USER ];
	then getSudoUser=$SUDO_USER;
	else getSudoUser=`whoami`;
fi

getDesktopEntry=/home/$getSudoUser/.config/autostart/qortal-hub.desktop;

# Remove desktop entry if exists
if [ -f $getDesktopEntry ]; then
    sudo rm $getDesktopEntry;
fi

# App directory which contains all the config and settings files
appDirectory=/home/$getSudoUser/.config/qortal-hub/;

if [ -d $appDirectory ]; then
    sudo rm -rf $appDirectory;
fi

# Delete the link to the binary
rm -f '/usr/bin/${executable}'

# Delete run-hub
rm -f '/opt/${productFilename}/run-hub'
