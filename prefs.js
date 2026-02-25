import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class GnomeAssistantPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // Obtenemos las configuraciones definidas en el esquema XML
        const settings = this.getSettings();

        // Creamos una página de preferencias
        const page = new Adw.PreferencesPage();
        window.add(page);

        // Creamos un grupo (una tarjeta que agrupa opciones)
        const group = new Adw.PreferencesGroup({
            title: 'Conexión con Home Assistant',
            description: 'Ingresa los datos para conectarte a tu servidor local.'
        });
        page.add(group);

        // Fila para ingresar la URL
        const urlRow = new Adw.EntryRow({
            title: 'URL del servidor',
        });
        group.add(urlRow);

        // Fila para ingresar el Token
        const tokenRow = new Adw.EntryRow({
            title: 'Token de acceso',
        });
        group.add(tokenRow);

        // Vinculamos visualmente los inputs con la base de datos de GSettings
        settings.bind('ha-url', urlRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('ha-token', tokenRow, 'text', Gio.SettingsBindFlags.DEFAULT);
    }
}
