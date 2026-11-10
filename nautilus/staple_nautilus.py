"""Staple for Files (Nautilus): adds "Create Desktop Shortcut" to the
right-click menu of folders and files.

A folder or file gets a symbolic link on the desktop, which shows the item's
own icon and can be moved around like any other desktop icon. If the item is
an app launcher (a .desktop file), it is copied and marked as trusted, so a
double click launches it.

Needs python3-nautilus. Installed to /usr/share/nautilus-python/extensions/.
"""
import os
import shutil
import subprocess

import gi

gi.require_version('Nautilus', '4.0')
from gi.repository import GLib, GObject, Nautilus  # noqa: E402


def desktop_dir():
    return GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) or \
        os.path.join(os.path.expanduser('~'), 'Desktop')


def free_name(folder, name):
    """name, or "name (shortcut)", "name (shortcut 2)" and so on."""
    candidate, n = name, 1
    base, ext = os.path.splitext(name) if name.endswith('.desktop') else (name, '')
    while os.path.lexists(os.path.join(folder, candidate)):
        n += 1
        tag = ' (shortcut)' if n == 2 else f' (shortcut {n - 1})'
        candidate = f'{base}{tag}{ext}'
    return candidate


def create_shortcut(source):
    """Makes the shortcut. Returns (status, path); status is 'created',
    'exists' or 'error'."""
    folder = desktop_dir()
    try:
        os.makedirs(folder, exist_ok=True)
        name = os.path.basename(source.rstrip('/')) or source
        if source.endswith('.desktop') and os.path.isfile(source):
            destination = os.path.join(folder, name)
            if os.path.lexists(destination):
                return 'exists', destination
            shutil.copy2(source, destination)
            os.chmod(destination, 0o755)
            subprocess.run(['gio', 'set', destination, 'metadata::trusted', 'true'],
                           check=False, capture_output=True)
            return 'created', destination

        # An existing link to this same item means there is nothing to do.
        for entry in os.listdir(folder):
            path = os.path.join(folder, entry)
            if os.path.islink(path) and os.path.realpath(path) == os.path.realpath(source):
                return 'exists', path
        destination = os.path.join(folder, free_name(folder, name))
        os.symlink(source, destination)
        return 'created', destination
    except OSError as error:
        return 'error', str(error)


def notify(title, body):
    try:
        subprocess.run(['notify-send', '--icon=emblem-symbolic-link', '--app-name=Staple', title, body],
                       check=False, capture_output=True)
    except OSError:
        pass


def local_path(file_info):
    if file_info.get_uri_scheme() != 'file':
        return None
    location = file_info.get_location()
    return location.get_path() if location else None


def on_desktop(path):
    # Look at where the item sits, not where a link on the desktop points.
    return os.path.realpath(os.path.dirname(os.path.abspath(path))) == os.path.realpath(desktop_dir())


class StapleExtension(GObject.GObject, Nautilus.MenuProvider):
    def _items(self, paths, label):
        paths = [p for p in paths if p and not on_desktop(p)]
        if not paths:
            return []
        if len(paths) > 1:
            label = f'Create {len(paths)} Desktop Shortcuts'
        item = Nautilus.MenuItem(name='Staple::CreateShortcut', label=label,
                                 tip='Put a link on the desktop that you can move around')
        item.connect('activate', self._on_activate, paths)
        return [item]

    def get_file_items(self, *args):
        files = args[-1]
        return self._items([local_path(f) for f in files], 'Create Desktop Shortcut')

    def get_background_items(self, *args):
        folder = args[-1]
        return self._items([local_path(folder)], 'Create Desktop Shortcut to This Folder')

    def _on_activate(self, _item, paths):
        made, existing, errors = [], [], []
        for path in paths:
            status, result = create_shortcut(path)
            {'created': made, 'exists': existing, 'error': errors}[status].append(os.path.basename(path) or path)
        if made:
            notify('Shortcut created', ', '.join(made) + ' is now on your desktop. Drag it wherever you like.')
        elif existing:
            notify('Already on your desktop', ', '.join(existing) + ' already has a shortcut there.')
        if errors:
            notify('Staple could not make a shortcut', ', '.join(errors))
