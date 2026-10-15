#!/usr/bin/env bash
# The two systemd units of the login screen auto-sync, as functions that print
# them. Sourced by install-gdm.sh; kept apart so tools/test-install.sh can check
# them without root. Nothing here writes a file or runs systemctl.

# sync_service_unit SYNC_SCRIPT USER USER_DATA_HOME DEST UUID
# The user's data folder (XDG_DATA_HOME) and the destination are passed to the
# script: it must not guess them from the home folder.
sync_service_unit() {
  local script="$1" user="$2" data_home="$3" dest="$4" uuid="$5"
  cat <<UNIT
[Unit]
Description=Copy the GNOMAC extension to the GDM login screen

[Service]
Type=oneshot
Environment=GNOMAC_SYNC_SRC=$data_home/gnome-shell/extensions/$uuid
Environment=GNOMAC_SYNC_DEST=$dest
ExecStart=$script $user
UNIT
}

# sync_path_unit USER_CONFIG_HOME
# Watches the file every GNOMAC install or update rewrites (XDG_CONFIG_HOME).
sync_path_unit() {
  local config_home="$1"
  cat <<UNIT
[Unit]
Description=Watch for a GNOMAC update (login screen sync)

[Path]
PathChanged=$config_home/gnomac/installed.json
Unit=gnomac-gdm-sync.service

[Install]
WantedBy=multi-user.target
UNIT
}
