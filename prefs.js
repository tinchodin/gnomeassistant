import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Lista de íconos nativos GARANTIZADOS en GNOME Adwaita
const ICONS = [
    { id: 'lightbulb-symbolic', name: '💡 Luz (Por defecto)' },
    { id: 'system-users-symbolic', name: '🍞 Cocina' }, // No hay comida, usamos 'familia/reunión'
    { id: 'drive-multidisk-symbolic', name: '🚗 Garaje' }, // Parece una puerta de garaje cerrada
    { id: 'weather-clear-night-symbolic', name: '🛏️ Cuartos' }, // Luna
    { id: 'weather-showers-symbolic', name: '🚽 Baño' }, // Ducha / Agua
    { id: 'computer-symbolic', name: '🖥️ Escritorio' }, // PC
    { id: 'weather-clear-symbolic', name: '🥩 Barbacoa' }, // Sol / Fuego / Calor
    { id: 'go-home-symbolic', name: '🪞 Recibidor' }, // Casa
    { id: 'accessories-dictionary-symbolic', name: '📚 Biblioteca' }, // Libro
    { id: 'view-refresh-symbolic', name: '🚰 Lavadero' }, // Ciclo de lavarropas
    { id: 'video-display-symbolic', name: '📺 Sala / TV' }, // Pantalla
    { id: 'weather-few-clouds-symbolic', name: '☀️ Patio / Exterior' }, // Clima exterior
    { id: 'camera-web-symbolic', name: '📷 Cámara' },
    { id: 'audio-speakers-symbolic', name: '🔊 Audio / Música' },
    { id: 'fan-symbolic', name: '🌬️ Ventilador' }, // Algunos sistemas no lo tienen, pero suele funcionar
    { id: 'weather-tornado-symbolic', name: '❄️ Aire Acondicionado' }, // Tornado / Viento
    { id: 'network-wireless-symbolic', name: '📡 Red / Router' },
    { id: 'star-symbolic', name: '⭐ Favorito' }
];

export default class GnomeAssistantPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        // Grupo 1: Conexión
        const group = new Adw.PreferencesGroup({
            title: 'Conexión con Home Assistant',
            description: 'Ingresa los datos para conectarte a tu servidor local.'
        });
        page.add(group);

        const urlRow = new Adw.EntryRow({ title: 'URL del servidor' });
        group.add(urlRow);

        const tokenRow = new Adw.EntryRow({ title: 'Token de acceso' });
        group.add(tokenRow);

        // Grupo 2: Filtros y Ocultamiento
        const ignoreGroup = new Adw.PreferencesGroup({
            title: 'Filtros y Ocultamiento',
            description: 'Escribe aquí lo que no quieras ver.\n\n✨ ¡TIP MÁGICO! ✨\n¡Puedes hacer clic derecho sobre cualquier Área o Luz en el panel superior para ocultarla instantáneamente sin tener que escribir su nombre aquí!'
        });
        page.add(ignoreGroup);

        const ignoreRow = new Adw.EntryRow({
            title: 'Ignorados (separados por coma)',
        });
        ignoreGroup.add(ignoreRow);

        // Grupo 3: Personalización de Íconos
        const discoveredStr = settings.get_string('discovered-areas');
        const areas = discoveredStr ? discoveredStr.split(',').filter(a => a.trim() !== '') : [];
        let customIcons = {};
        try { customIcons = JSON.parse(settings.get_string('custom-icons')); } catch (e) {}

        const iconsGroup = new Adw.PreferencesGroup({
            title: 'Personalización de Íconos',
            description: areas.length > 0
                ? 'Selecciona el ícono para cada área detectada.'
                : 'Abre el menú de la extensión una vez para detectar tus áreas.'
        });
        page.add(iconsGroup);

        areas.forEach(area => {
            const model = new Gtk.StringList();
            ICONS.forEach(ic => model.append(ic.name));

            const row = new Adw.ComboRow({
                title: area,
                model: model
            });

            // Seleccionar el ícono guardado o el por defecto
            let currentIconId = customIcons[area] || 'lightbulb-symbolic';
            let index = ICONS.findIndex(ic => ic.id === currentIconId);
            if (index !== -1) row.selected = index;

            // Guardar el JSON al cambiar de opción
            row.connect('notify::selected', () => {
                let selectedId = ICONS[row.selected].id;
                customIcons[area] = selectedId;
                settings.set_string('custom-icons', JSON.stringify(customIcons));
            });

            iconsGroup.add(row);
        });

        // Vincular los inputs a la base de datos local
        settings.bind('ha-url', urlRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('ha-token', tokenRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('ignored-items', ignoreRow, 'text', Gio.SettingsBindFlags.DEFAULT);
    }
}
