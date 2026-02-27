import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Built-in Adwaita icons suitable for common home areas
const ICONS = (() => {
    const rawIcons = [
        { id: 'emoji-objects-symbolic', name: 'Default' },
        { id: 'emoji-food-symbolic', name: 'Kitchen' },
        { id: 'computer-symbolic', name: 'Office' },
        { id: 'tv-symbolic', name: 'Living Room / TV' },
        { id: 'video-display-symbolic', name: 'Living Room / Display' },
        { id: 'drive-multidisk-symbolic', name: 'Garage' },
        { id: 'go-home-symbolic', name: 'Hallway' },
        { id: 'user-home-symbolic', name: 'Home / Other' },
        { id: 'accessories-dictionary-symbolic', name: 'Library' },
        { id: 'view-refresh-symbolic', name: 'Laundry' },
        { id: 'camera-web-symbolic', name: 'Camera' },
        { id: 'audio-speakers-symbolic', name: 'Audio' },
        { id: 'folder-music-symbolic', name: 'Music' },
        { id: 'network-wireless-symbolic', name: 'Wi-Fi' },
        { id: 'network-server-symbolic', name: 'Network / Router' },
        { id: 'system-users-symbolic', name: 'Common Area' },
        { id: 'night-light-symbolic', name: 'Bedroom (Night)' },
        { id: 'dialog-password', name: 'Password / Lock' },
        { id: 'channel-secure', name: 'Secure Channel' },
        { id: 'network-cellular-gprs', name: 'Cellular (GPRS)' },
        { id: 'document-print', name: 'Print' },
        { id: 'user-trash', name: 'Trash' },
        { id: 'audio-x-generic', name: 'Audio File' },
        { id: 'document-open-recent', name: 'Recent Documents' },
        { id: 'weather-clear-symbolic', name: 'Weather: Clear' },
        { id: 'weather-clear-night-symbolic', name: 'Weather: Clear Night' },
        { id: 'weather-few-clouds-symbolic', name: 'Weather: Few Clouds' },
        { id: 'weather-few-clouds-night-symbolic', name: 'Weather: Few Clouds Night' },
        { id: 'weather-fog-symbolic', name: 'Weather: Fog' },
        { id: 'weather-hourly-symbolic', name: 'Weather: Hourly' },
        { id: 'weather-overcast-symbolic', name: 'Weather: Overcast' },
        { id: 'weather-severe-alert-symbolic', name: 'Weather: Severe Alert' },
        { id: 'weather-showers-symbolic', name: 'Weather: Showers' },
        { id: 'weather-showers-scattered-symbolic', name: 'Weather: Scattered Showers' },
        { id: 'weather-snow-symbolic', name: 'Weather: Snow' },
        { id: 'weather-storm-symbolic', name: 'Weather: Storm' },
        { id: 'weather-tornado-symbolic', name: 'Weather: Tornado' },
        { id: 'weather-windy-symbolic', name: 'Weather: Windy' }
    ];

    const seen = new Set();
    return rawIcons.filter(icon => {
        if (seen.has(icon.id)) return false;
        seen.add(icon.id);
        return true;
    });
})();

function buildIconFactory(iconLabels) {
    const factory = new Gtk.SignalListItemFactory();

    factory.connect('setup', (_factory, listItem) => {
        const image = new Gtk.Image({
            pixel_size: 18,
            margin_top: 4,
            margin_bottom: 4,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        listItem.set_child(image);
    });

    factory.connect('bind', (_factory, listItem) => {
        const image = listItem.get_child();
        const item = listItem.get_item();

        if (!item) {
            image.set_from_icon_name('emoji-objects-symbolic');
            image.set_tooltip_text('');
            return;
        }

        const iconId = item.get_string();
        image.set_from_icon_name(iconId);
        image.set_tooltip_text(iconLabels.get(iconId) || iconId);
    });

    return factory;
}

export default class GnomeAssistantPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        // Group 1: Connection
        const group = new Adw.PreferencesGroup({
            title: 'Home Assistant Connection',
            description: 'Enter the details to connect to your local server.'
        });
        page.add(group);

        const urlRow = new Adw.EntryRow({ title: 'Server URL' });
        group.add(urlRow);

        const tokenRow = new Adw.EntryRow({ title: 'Access Token' });
        group.add(tokenRow);

        // Group 2: Filters and hidden items
        const ignoreGroup = new Adw.PreferencesGroup({
            title: 'Filters and Hidden Items',
            description: 'List items you do not want to display.\n\nTip: right-click any area or device in the top panel menu to hide it instantly.'
        });
        page.add(ignoreGroup);

        const ignoreRow = new Adw.EntryRow({
            title: 'Ignored items (comma-separated)',
        });
        ignoreGroup.add(ignoreRow);

        const quickSettingsGroup = new Adw.PreferencesGroup({
            title: 'Quick Settings',
            description: 'Visual options for panel quick settings.'
        });
        page.add(quickSettingsGroup);

        const separatorRow = new Adw.SwitchRow({
            title: 'Show separator',
            subtitle: 'Display a divider with a home icon before extension controls'
        });
        quickSettingsGroup.add(separatorRow);

        // Group 3: Icon customization
        const discoveredStr = settings.get_string('discovered-areas');
        const areas = Array.from(new Set((discoveredStr ? discoveredStr.split(',') : []).map(a => a.trim()).filter(a => a !== '' && a !== 'Other')));
        areas.push('Other');

        let customIcons = {};
        try { customIcons = JSON.parse(settings.get_string('custom-icons')); } catch (e) {}

        const iconsGroup = new Adw.PreferencesGroup({
            title: 'Icon Customization',
            description: areas.length > 0
                ? 'Select an icon for each detected area.'
                : 'Open the extension menu once to detect your areas.'
        });
        page.add(iconsGroup);

        const iconLabels = new Map(ICONS.map(ic => [ic.id, ic.name]));

        areas.forEach(area => {
            const model = new Gtk.StringList();
            ICONS.forEach(ic => model.append(ic.id));

            const dropdown = new Gtk.DropDown({
                model,
                valign: Gtk.Align.CENTER,
            });
            dropdown.set_factory(buildIconFactory(iconLabels));
            dropdown.set_list_factory(buildIconFactory(iconLabels));

            const row = new Adw.ActionRow({ title: area });
            row.add_suffix(dropdown);
            row.activatable_widget = dropdown;

            // Use the saved icon or the default icon
            let currentIconId = customIcons[area] || 'emoji-objects-symbolic';
            let index = ICONS.findIndex(ic => ic.id === currentIconId);
            dropdown.set_selected(index !== -1 ? index : 0);

            // Persist the JSON mapping when the selection changes
            dropdown.connect('notify::selected', () => {
                const selected = dropdown.get_selected();
                if (selected < 0 || selected >= ICONS.length) return;

                customIcons[area] = ICONS[selected].id;
                settings.set_string('custom-icons', JSON.stringify(customIcons));
            });

            iconsGroup.add(row);
        });

        // Bind input fields to local settings
        settings.bind('ha-url', urlRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('ha-token', tokenRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('ignored-items', ignoreRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-separator', separatorRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    }
}
