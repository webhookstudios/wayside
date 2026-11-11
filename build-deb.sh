#!/bin/sh
# Builds dist/wayside_<version>_all.deb. Needs only dpkg-deb.
#
# The package installs Wayside for every user of the machine:
#   /usr/share/gnome-shell/extensions/<uuid>/   the extension
#   /usr/share/glib-2.0/schemas/                its settings schema
#   /usr/bin/wayside                              apps-menu launcher
#   /usr/share/applications, /usr/share/icons   apps-menu entry and icon
set -e

UUID=wayside@webhookstudios.github.io
APP_ID=io.github.webhookstudios.Wayside
ROOT="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(sed -n 's/.*"version-name": *"\([^"]*\)".*/\1/p' "$ROOT/$UUID/metadata.json")"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

EXT="$STAGE/usr/share/gnome-shell/extensions/$UUID"
install -d "$EXT" "$STAGE/DEBIAN" "$STAGE/usr/bin" \
    "$STAGE/usr/share/glib-2.0/schemas" \
    "$STAGE/usr/share/applications" \
    "$STAGE/usr/share/nautilus-python/extensions" \
    "$STAGE/usr/share/icons/hicolor/scalable/apps" \
    "$STAGE/usr/share/doc/wayside"

install -m 644 "$ROOT/$UUID"/*.js "$ROOT/$UUID/metadata.json" \
    "$ROOT/$UUID/stylesheet.css" "$EXT/"
cp -r "$ROOT/$UUID/sedge" "$EXT/"
find "$EXT/sedge" -type f -exec chmod 644 {} +
# With no schemas folder of its own, the extension reads its schema from
# the system one, which dpkg compiles through glib's trigger.
install -m 644 "$ROOT/$UUID/schemas"/*.gschema.xml "$STAGE/usr/share/glib-2.0/schemas/"
install -m 644 "$ROOT/nautilus/wayside_nautilus.py" "$STAGE/usr/share/nautilus-python/extensions/"
install -m 755 "$ROOT/data/launcher.js" "$STAGE/usr/bin/wayside"
install -m 644 "$ROOT/data/$APP_ID.svg" "$STAGE/usr/share/icons/hicolor/scalable/apps/"
sed -e 's|@EXEC@|wayside|' -e "s|@ICON@|$APP_ID|" "$ROOT/data/$APP_ID.desktop.in" \
    > "$STAGE/usr/share/applications/$APP_ID.desktop"
chmod 644 "$STAGE/usr/share/applications/$APP_ID.desktop"

# Turns Wayside on in place of Staple at the next login, for people who had Staple on.
install -d "$STAGE/usr/lib/wayside" "$STAGE/etc/xdg/autostart"
install -m 755 "$ROOT/data/wayside-take-over" "$STAGE/usr/lib/wayside/"
install -m 644 "$ROOT/data/io.github.webhookstudios.Wayside.take-over.desktop" "$STAGE/etc/xdg/autostart/"

cat > "$STAGE/usr/share/doc/wayside/copyright" <<EOF
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: Wayside
Source: https://github.com/webhookstudios/wayside

Files: *
Copyright: $(date +%Y) webhookstudios
License: GPL-2+
 On Debian systems, the full text of the GNU General Public License
 version 2 can be found in /usr/share/common-licenses/GPL-2.

Files: usr/share/gnome-shell/extensions/*/sedge/fonts/*
Copyright: 2023 The Young Serif Project Authors; 2015 The Public Sans Project Authors
License: OFL-1.1
 The full license texts are in the extension's sedge/fonts/ folder.
EOF
chmod 644 "$STAGE/usr/share/doc/wayside/copyright"

# Replaces/Breaks take over from this app's old package name, staple.
cat > "$STAGE/DEBIAN/control" <<EOF
Package: wayside
Version: $VERSION
Architecture: all
Maintainer: webhookstudios <354619278+webhookstudios@users.noreply.github.com>
Installed-Size: $(du -sk "$STAGE/usr" | cut -f1)
Depends: gnome-shell (>= 50~), gnome-shell (<< 51~), gjs, gir1.2-adw-1, gir1.2-gtk-4.0, python3-nautilus
Replaces: staple (<< 2~)
Breaks: staple (<< 2~)
Section: gnome
Priority: optional
Homepage: https://github.com/webhookstudios/wayside
Description: Right-click Create Desktop Shortcut for apps, folders and files
 Wayside adds Create Desktop Shortcut to the right-click menu of apps in the
 dock, the app grid and the Activities dash, and of folders and files in
 the Files app. The shortcut appears on your desktop and can be moved
 around like any other icon.
 .
 After installing, log out and back in, then open Wayside from the apps menu.
EOF

# Folders are created with the builder's umask; packages want 755.
find "$STAGE" -type d -exec chmod 755 {} +

mkdir -p "$ROOT/dist"
dpkg-deb --root-owner-group --build "$STAGE" "$ROOT/dist/wayside_${VERSION}_all.deb"
