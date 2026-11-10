// Puts a launcher for an app on the desktop. A shortcut is a copy of the
// app's own .desktop file, marked as trusted so a double click launches it.
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
        const destination = Gio.File.new_for_path(GLib.build_filenamev([folder, GLib.path_get_basename(source)]));
        if (destination.query_exists(null))
            return {status: 'exists', name, path: destination.get_path()};

        Gio.File.new_for_path(source).copy(destination, Gio.FileCopyFlags.NONE, null, null);
        destination.set_attribute_uint32('unix::mode', 0o755, Gio.FileQueryInfoFlags.NONE, null);
        try {
            // The desktop only launches launchers it has been told to trust.
            destination.set_attribute_string('metadata::trusted', 'true', Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            console.warn(`Staple: could not mark the shortcut as trusted: ${e.message}`);
        }
        return {status: 'created', name, path: destination.get_path()};
    } catch (e) {
        return {status: 'error', name, message: `Could not create the shortcut: ${e.message}`};
    }
}
