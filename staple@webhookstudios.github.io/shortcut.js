// Puts a launcher for an app on the desktop. A shortcut is a copy of the
// app's own .desktop file, marked as trusted so a double click launches it,
// and given its app's icon as a custom icon. The custom icon matters because
// the Files app shows a plain gear for launcher files inside folders; with
// it, a shortcut dragged into a folder still looks like the app, and the
// setting travels with the file.
// Once it is there it is an ordinary desktop icon, so it can be moved,
// renamed or deleted like any other.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function desktopPath() {
    return GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) ??
        GLib.build_filenamev([GLib.get_home_dir(), 'Desktop']);
}

// Returns {status, name, path}. status is 'created', 'exists' or 'error'.
export function createAppShortcut(app) {
    const info = app?.get_app_info?.();
    const source = info?.get_filename?.();
    const name = info?.get_name?.() ?? app?.get_name?.() ?? 'App';
    if (!source)
        return {status: 'error', name, message: `${name} has no launcher file to copy.`};

    try {
        const folder = desktopPath();
        GLib.mkdir_with_parents(folder, 0o755);
        // Named after the app ("Files.desktop"), because the Files app shows
        // the file name, not the name inside. If that name is taken by a
        // different launcher, the original file name is used instead.
        const sourceFile = Gio.File.new_for_path(source);
        const sourceBytes = sourceFile.load_contents(null)[1];
        const safeName = name.replace(/[\/\u0000]/g, '-').trim() || GLib.path_get_basename(source);
        let destination = null;
        for (const candidate of [`${safeName}.desktop`, GLib.path_get_basename(source)]) {
            const file = Gio.File.new_for_path(GLib.build_filenamev([folder, candidate]));
            if (!file.query_exists(null)) {
                destination = file;
                break;
            }
            const same = file.load_contents(null)[1];
            if (same.length === sourceBytes.length && same.every((b, i) => b === sourceBytes[i]))
                return {status: 'exists', name, path: file.get_path()};
        }
        if (!destination)
            return {status: 'exists', name, path: folder};

        sourceFile.copy(destination, Gio.FileCopyFlags.NONE, null, null);
        destination.set_attribute_uint32('unix::mode', 0o755, Gio.FileQueryInfoFlags.NONE, null);
        try {
            // The desktop only launches launchers it has been told to trust.
            destination.set_attribute_string('metadata::trusted', 'true', Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            console.warn(`Staple: could not mark the shortcut as trusted: ${e.message}`);
        }
        try {
            const iconFile = findIconFile(info.get_string('Icon'));
            if (iconFile) {
                destination.set_attribute_string('metadata::custom-icon', Gio.File.new_for_path(iconFile).get_uri(),
                    Gio.FileQueryInfoFlags.NONE, null);
            }
        } catch (e) {
            console.warn(`Staple: could not set the shortcut's icon: ${e.message}`);
        }
        return {status: 'created', name, path: destination.get_path()};
    } catch (e) {
        return {status: 'error', name, message: `Could not create the shortcut: ${e.message}`};
    }
}


const ICON_SIZES = ['scalable', '512x512', '256x256', '128x128', '96x96', '64x64', '48x48'];

function exists(path) {
    return GLib.file_test(path, GLib.FileTest.EXISTS);
}

// Finds the file behind an Icon= value: either a path already, or a name to
// look up in the current icon theme and then hicolor.
export function findIconFile(icon) {
    if (!icon)
        return null;
    if (GLib.path_is_absolute(icon))
        return exists(icon) ? icon : null;

    let theme = 'hicolor';
    try {
        theme = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).get_string('icon-theme');
    } catch {
        // keep the default
    }
    const roots = [
        GLib.build_filenamev([GLib.get_user_data_dir(), 'icons']),
        GLib.build_filenamev([GLib.get_home_dir(), '.icons']),
        ...GLib.get_system_data_dirs().map(dir => GLib.build_filenamev([dir, 'icons'])),
    ];
    for (const name of [theme, 'hicolor']) {
        for (const size of ICON_SIZES) {
            for (const root of roots) {
                for (const ext of ['svg', 'png']) {
                    const path = GLib.build_filenamev([root, name, size, 'apps', `${icon}.${ext}`]);
                    if (exists(path))
                        return path;
                }
            }
        }
    }
    for (const dir of GLib.get_system_data_dirs()) {
        for (const ext of ['svg', 'png', 'xpm']) {
            const path = GLib.build_filenamev([dir, 'pixmaps', `${icon}.${ext}`]);
            if (exists(path))
                return path;
        }
    }
    return null;
}
