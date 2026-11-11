#!/bin/sh
# Installs Wayside for the current user, without root: the shell extension for
# app icons, the Files right-click option (needs python3-nautilus), and an
# apps-menu entry that opens the settings.
set -e

UUID=staple@webhookstudios.github.io
APP_ID=io.github.webhookstudios.Staple
ROOT="$(cd "$(dirname "$0")" && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="$DATA/gnome-shell/extensions/$UUID"

mkdir -p "$DATA/gnome-shell/extensions" "$DATA/staple" "$DATA/applications" \
    "$DATA/icons/hicolor/scalable/apps" "$DATA/nautilus-python/extensions"

if [ -L "$DEST" ]; then
    echo "Keeping existing link: $DEST"
else
    rm -rf "$DEST"
    cp -r "$ROOT/$UUID" "$DEST"
fi
glib-compile-schemas "$DEST/schemas"

cp "$ROOT/nautilus/staple_nautilus.py" "$DATA/nautilus-python/extensions/staple_nautilus.py"
cp "$ROOT/data/launcher.js" "$DATA/staple/launcher.js"
cp "$ROOT/data/$APP_ID.svg" "$DATA/icons/hicolor/scalable/apps/"
ICON="$DATA/icons/hicolor/scalable/apps/$APP_ID.svg"
sed -e "s|@EXEC@|gjs -m \"$DATA/staple/launcher.js\"|" -e "s|@ICON@|$ICON|" \
    "$ROOT/data/$APP_ID.desktop.in" > "$DATA/applications/$APP_ID.desktop"
update-desktop-database "$DATA/applications" 2>/dev/null || true

cat <<EOM
Wayside is installed in:
  $DEST

Log out and back in, then open Wayside from the apps menu.
Right-clicking folders and files in Files also needs the python3-nautilus
package ("sudo apt install python3-nautilus"), then "nautilus -q".
EOM
