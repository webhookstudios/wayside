import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {applyToWindow as applySedge} from './sedge/sedge.js';

function switchRow(settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export default class WaysidePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        applySedge(window, `${this.path}/sedge`);
        window.set_title('Wayside');
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        const where = new Adw.PreferencesGroup({
            title: 'Where the option appears',
            description: 'Right-click an app, folder or file and choose Create Desktop Shortcut.',
        });
        where.add(switchRow(settings, 'show-in-dock', 'Dock', 'Right-click an app icon in the dock'));
        where.add(switchRow(settings, 'show-in-app-menus', 'App grid and Activities',
            'Right-click an app in the app grid or the Activities dash'));
        page.add(where);

        const files = new Adw.PreferencesGroup({title: 'Folders and files'});
        files.add(new Adw.ActionRow({
            title: 'In the Files app',
            subtitle: 'Right-click any folder or file in Files. This part is installed with the package and ' +
                'needs python3-nautilus. Files may need to be restarted once (run nautilus -q).',
        }));
        page.add(files);

        const after = new Adw.PreferencesGroup({title: 'After a shortcut is made'});
        after.add(switchRow(settings, 'notify', 'Show a message', 'A short note saying the shortcut is on the desktop'));
        page.add(after);
    }
}
