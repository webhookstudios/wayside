"""Staple for Files (Nautilus): adds "Create Desktop Shortcut" to the
right-click menu of folders and files.

A folder or file gets a symbolic link on the desktop, which shows the item's
own icon and can be moved around like any other desktop icon. If the item is
an app launcher (a .desktop file), it is copied and marked as trusted, so a
double click launches it.

Needs python3-nautilus. Installed to /usr/share/nautilus-python/extensions/.
"""
import configparser
import filecmp
import os
import shutil
import subprocess

import gi

# Ubuntu 26.04 ships the bindings as Nautilus 4.1; older releases call it 4.0.
for _version in ('4.1', '4.0'):
    try:
        gi.require_version('Nautilus', _version)
        break
    except ValueError:
        continue
from gi.repository import Gio, GLib, GObject, Nautilus  # noqa: E402


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


ICON_SIZES = ['scalable', '512x512', '256x256', '128x128', '96x96', '64x64', '48x48']


def find_icon_file(icon):
    """The file behind an Icon= value: a path already, or a name to look up in
    the current icon theme and then hicolor."""
    if not icon:
        return None
    if os.path.isabs(icon):
        return icon if os.path.exists(icon) else None
    theme = 'hicolor'
    try:
        theme = Gio.Settings.new('org.gnome.desktop.interface').get_string('icon-theme')
    except Exception:  # no such schema, keep the default
        pass
    data_home = os.environ.get('XDG_DATA_HOME') or os.path.expanduser('~/.local/share')
    data_dirs = (os.environ.get('XDG_DATA_DIRS') or '/usr/local/share:/usr/share').split(':')
    roots = [os.path.join(data_home, 'icons'), os.path.expanduser('~/.icons')] + \
        [os.path.join(d, 'icons') for d in data_dirs]
    for name in (theme, 'hicolor'):
        for size in ICON_SIZES:
            for root in roots:
                for ext in ('svg', 'png'):
                    path = os.path.join(root, name, size, 'apps', f'{icon}.{ext}')
                    if os.path.exists(path):
                        return path
    for d in data_dirs:
        for ext in ('svg', 'png', 'xpm'):
            path = os.path.join(d, 'pixmaps', f'{icon}.{ext}')
            if os.path.exists(path):
                return path
    return None


def launcher_name(path):
    parser = configparser.RawConfigParser(strict=False, interpolation=None)
    parser.optionxform = str
    try:
        parser.read(path, encoding='utf-8')
        value = parser.get('Desktop Entry', 'Name', fallback='')
    except (configparser.Error, UnicodeDecodeError, OSError):
        return ''
    return value.replace('/', '-').replace('\0', '').strip()


def desktop_icon(path):
    parser = configparser.RawConfigParser(strict=False, interpolation=None)
    parser.optionxform = str
    try:
        parser.read(path, encoding='utf-8')
        return parser.get('Desktop Entry', 'Icon', fallback=None)
    except (configparser.Error, UnicodeDecodeError, OSError):
        return None


def set_attribute(path, key, value):
    subprocess.run(['gio', 'set', '-t', 'string', path, key, value], check=False, capture_output=True)


def create_shortcut(source):
    """Makes the shortcut. Returns (status, path); status is 'created',
    'exists' or 'error'."""
    folder = desktop_dir()
    try:
        os.makedirs(folder, exist_ok=True)
        name = os.path.basename(source.rstrip('/')) or source
        if source.endswith('.desktop') and os.path.isfile(source):
            # Named after the app ("Files.desktop"), because Files shows the
            # file name. If that name is taken by a different launcher, the
            # original file name is used instead.
            app_name = launcher_name(source)
            destination = None
            for candidate in ([f'{app_name}.desktop'] if app_name else []) + [name]:
                path = os.path.join(folder, candidate)
                if not os.path.lexists(path):
                    destination = path
                    break
                if os.path.isfile(path) and filecmp.cmp(source, path, shallow=False):
                    return 'exists', path
            if destination is None:
                return 'exists', os.path.join(folder, name)
            shutil.copy2(source, destination)
            os.chmod(destination, 0o755)
            subprocess.run(['gio', 'set', destination, 'metadata::trusted', 'true'],
                           check=False, capture_output=True)
            # Files shows a plain gear for launchers inside folders. A custom
            # icon keeps the app's own, wherever the shortcut is moved to.
            icon_file = find_icon_file(desktop_icon(source))
            if icon_file:
                set_attribute(destination, 'metadata::custom-icon', 'file://' + icon_file)
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
