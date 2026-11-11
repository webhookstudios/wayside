import GLib from 'gi://GLib';
import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';

import {createAppShortcut} from './shortcut.js';

const LABEL = 'Create Desktop Shortcut';

// Docks that build their own right-click menu. Wayside adds its item to each
// one that is installed.
const DOCKS = ['ubuntu-dock@ubuntu.com', 'dash-to-dock@micxgx.gmail.com'];

function launcherFile(app) {
    try {
        return app?.get_app_info?.()?.get_filename?.() ?? null;
    } catch {
        return null;
    }
}

export default class WaysideExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._injection = new InjectionManager();
        this._menus = new Set();
        this._active = true;

        const wayside = this;
        // The app grid and the Activities dash share this menu class. The menu
        // is told which app it is for by setApp(), so the item is added there.
        this._injection.overrideMethod(AppMenu.prototype, 'setApp', original => function (app) {
            original.call(this, app);
            wayside._decorateShellMenu(this, app);
        });

        this._hookDocks();
    }

    disable() {
        this._active = false;
        this._injection?.clear();
        this._injection = null;
        for (const menu of this._menus) {
            menu._waysideItem?.destroy();
            menu._waysideItem = null;
            if (menu._waysideRebuild) {
                delete menu._rebuildMenu;   // falls back to the class's own method
                menu._waysideRebuild = null;
            }
        }
        this._menus = null;
        this._settings = null;
    }

    // ---- the shell's own app menu --------------------------------------

    _decorateShellMenu(menu, app) {
        menu._waysideApp = app;
        if (!menu._waysideItem) {
            const item = new PopupMenu.PopupMenuItem(LABEL);
            item.connect('activate', () => this._create(menu._waysideApp));
            const items = menu._getMenuItems();
            const after = items.indexOf(menu._toggleFavoriteItem);
            menu.addMenuItem(item, after >= 0 ? after + 1 : items.length);
            menu._waysideItem = item;
            this._menus.add(menu);
            menu.connect('destroy', () => this._menus?.delete(menu));
        }
        menu._waysideItem.visible = this._settings.get_boolean('show-in-app-menus') && !!launcherFile(app);
    }

    // ---- docks ----------------------------------------------------------

    async _hookDocks() {
        for (const uuid of DOCKS) {
            const extension = Main.extensionManager.lookup(uuid);
            if (!extension?.dir)
                continue;
            try {
                const module = await import(extension.dir.get_child('appIcons.js').get_uri());
                if (!this._active)
                    return;
                const proto = module.DockAbstractAppIcon?.prototype;
                if (!proto?.popupMenu)
                    continue;
                const wayside = this;
                this._injection.overrideMethod(proto, 'popupMenu', original => function (...args) {
                    const result = original.apply(this, args);
                    wayside._decorateDockMenu(this._menu, this);
                    return result;
                });
            } catch (e) {
                console.warn(`Wayside: could not add to the menu of ${uuid}: ${e.message}`);
            }
        }
    }

    _decorateDockMenu(menu, icon) {
        if (!menu || !this._active)
            return;
        menu._waysideApp = icon.app;
        if (!menu._waysideRebuild) {
            // The dock throws its menu away and rebuilds it every time it opens.
            const rebuild = menu._rebuildMenu.bind(menu);
            menu._rebuildMenu = () => {
                rebuild();
                this._addDockItem(menu);
            };
            menu._waysideRebuild = true;
            this._menus.add(menu);
            menu.connect('destroy', () => this._menus?.delete(menu));
            // This first time the menu is already built and open.
            this._addDockItem(menu);
        }
    }

    _addDockItem(menu) {
        menu._waysideItem?.destroy();
        menu._waysideItem = null;
        if (!this._active || !this._settings.get_boolean('show-in-dock') || !launcherFile(menu._waysideApp))
            return;

        const item = new PopupMenu.PopupMenuItem(LABEL);
        item.connect('activate', () => this._create(menu._waysideApp));
        // Just above the separator that sits in front of Quit.
        const items = menu._getMenuItems();
        const quit = items.indexOf(menu._quitMenuItem);
        const position = quit > 0 && items[quit - 1] instanceof PopupMenu.PopupSeparatorMenuItem ? quit - 1 : items.length;
        menu.addMenuItem(item, position);
        menu._waysideItem = item;
    }

    // ---- the action -----------------------------------------------------

    _create(app) {
        const result = createAppShortcut(app);
        if (!this._settings.get_boolean('notify') && result.status !== 'error')
            return;
        const messages = {
            created: [`${result.name} is on your desktop`, 'You can drag it wherever you like.'],
            exists: ['Already on your desktop', `${result.name} already has a shortcut there.`],
            error: ['Wayside could not make a shortcut', result.message],
        };
        const [title, body] = messages[result.status];
        Main.notify(title, body);
    }
}
