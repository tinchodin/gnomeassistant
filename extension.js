import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { QuickMenuToggle, SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js';
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';

// --- FUNCIÓN DE PETICIÓN A LA API ---
function haRequest(url, token, endpoint, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        if (!url || !token) {
            console.error('[HomeAssistant Ext] Error: Faltan credenciales en la configuración.');
            return reject(new Error('Faltan credenciales'));
        }

        let cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        let fullPath = `${cleanUrl}${endpoint}`;

        let session = new Soup.Session();
        let message = Soup.Message.new(method, fullPath);

        if (!message) {
            console.error(`[HomeAssistant Ext] Error: URL mal formateada: ${fullPath}`);
            return reject(new Error('URL mal formateada'));
        }

        message.request_headers.append('Authorization', `Bearer ${token}`);
        message.request_headers.append('Content-Type', 'application/json');

        if (data) {
            let bytes = GLib.Bytes.new(JSON.stringify(data));
            message.set_request_body_from_bytes('application/json', bytes);
        }

        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source_object, res) => {
            try {
                let bytes = source_object.send_and_read_finish(res);
                let status = message.get_status();

                if (status !== 200 && status !== 201) {
                    let errMsg = `Error HTTP ${status} en ${fullPath}`;
                    console.error(`[HomeAssistant Ext] ${errMsg}`);
                    reject(new Error(errMsg));
                    return;
                }

                let decoder = new TextDecoder('utf-8');
                let responseStr = decoder.decode(bytes.get_data());
                resolve(JSON.parse(responseStr));
            } catch (e) {
                console.error(`[HomeAssistant Ext] Excepción de red: ${e.message}`);
                reject(e);
            }
        });
    });
}

// --- MENÚ DESPLEGABLE CON LAS LUCES ---
const HALightsToggle = GObject.registerClass(
class HALightsToggle extends QuickMenuToggle {
    constructor(settings) {
        super({
            title: 'Home Assistant',
            iconName: 'lightbulb-symbolic',
            toggleMode: true,
        });

        this._settings = settings;

        this._scrollWrapper = new PopupMenu.PopupBaseMenuItem({ reactive: false, hover: false, can_focus: false });
        this._scrollWrapper.set_style_class_name('');
        this._scrollWrapper.x_expand = true;

        this._scrollView = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            style_class: 'vfade',
            style: 'max-height: 400px;',
            x_expand: true,
            y_expand: true,
        });

        this._lightsSection = new PopupMenu.PopupMenuSection();
        this._scrollView.add_child(this._lightsSection.actor);

        this._scrollWrapper.add_child(this._scrollView);
        this.menu.addMenuItem(this._scrollWrapper);

        this.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this._loadLights();
            }
        });
    }

    async _loadLights() {
        this._lightsSection.removeAll();

        let url = this._settings.get_string('ha-url');
        let token = this._settings.get_string('ha-token');

        if (!url || !token) {
            this._lightsSection.addMenuItem(new PopupMenu.PopupMenuItem('Faltan datos en Preferencias', { reactive: false }));
            return;
        }

        let loadingItem = new PopupMenu.PopupMenuItem('Cargando luces...', { reactive: false });
        this._lightsSection.addMenuItem(loadingItem);

        try {
            const states = await haRequest(url, token, '/api/states');
            
            this._lightsSection.removeAll();

            const lights = states.filter(s => s.entity_id.startsWith('light.'));
            
            if (lights.length === 0) {
                this._lightsSection.addMenuItem(new PopupMenu.PopupMenuItem('No se encontraron luces', { reactive: false }));
                return;
            }

            // --- NUEVO: Obtener las áreas reales usando el motor de plantillas de HA ---
            let areaMap = {};
            try {
                // Generamos un JSON desde Jinja2 que vincula entity_id -> Nombre del Área
                const templateStr = "{% set ns = namespace(items={}) %}{% for s in states.light %}{% set a = area_name(s.entity_id) %}{% if a %}{% set ns.items = dict(ns.items, **{s.entity_id: a}) %}{% endif %}{% endfor %}{{ ns.items | to_json }}";
                areaMap = await haRequest(url, token, '/api/template', 'POST', { template: templateStr });
            } catch (e) {
                console.warn(`[HomeAssistant Ext] Fallo al obtener áreas reales, usando fallback. Error: ${e.message}`);
            }

            const groupedLights = {};
            lights.forEach(light => {
                let area = 'Otros';

                // Si Home Assistant nos devolvió el área real, la usamos
                if (areaMap && areaMap[light.entity_id]) {
                    area = areaMap[light.entity_id];
                } else {
                    // Fallback de seguridad: Adivinar por el nombre si el dispositivo no tiene área asignada
                    let cleanId = light.entity_id.replace('light.', '');
                    let parts = cleanId.split('_');
                    if (parts.length > 1) {
                        area = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
                    }
                }
                
                if (!groupedLights[area]) groupedLights[area] = [];
                groupedLights[area].push(light);
            });

            // Ordenar alfabéticamente las áreas, dejando "Otros" al final
            const sortedAreas = Object.keys(groupedLights).sort((a, b) => {
                if (a === 'Otros') return 1;
                if (b === 'Otros') return -1;
                return a.localeCompare(b);
            });

            for (const area of sortedAreas) {
                const areaLights = groupedLights[area];
                
                let separator = new PopupMenu.PopupSeparatorMenuItem();
                separator.label.text = area;
                this._lightsSection.addMenuItem(separator);

                areaLights.forEach(light => {
                    let name = light.attributes.friendly_name || light.entity_id;
                    let isOn = light.state === 'on';
                    
                    let attrs = light.attributes || {};
                    let currentBrightness = attrs.brightness || 0;

                    let supportsBrightness = false;
                    
                    if ('brightness' in attrs && attrs.brightness !== null) {
                        supportsBrightness = true;
                    } else if (attrs.supported_color_modes && attrs.supported_color_modes.some(m => m !== 'onoff' && m !== 'unknown')) {
                        supportsBrightness = true;
                    } else if (attrs.supported_features !== undefined && (attrs.supported_features & 1)) {
                        supportsBrightness = true;
                    }

                    // 1. Creamos el Switch principal
                    let switchItem = new PopupMenu.PopupSwitchMenuItem(name, isOn);
                    this._lightsSection.addMenuItem(switchItem);

                    let sliderItem = null;
                    let slider = null;

                    // 2. Creamos el Slider SIEMPRE que la luz lo soporte, sin importar si está prendida o apagada
                    if (supportsBrightness) {
                        sliderItem = new PopupMenu.PopupBaseMenuItem({ activate: false });
                        
                        let icon = new St.Icon({
                            icon_name: 'display-brightness-symbolic',
                            style_class: 'popup-menu-icon'
                        });
                        sliderItem.add_child(icon);

                        slider = new Slider(currentBrightness / 255);
                        slider.x_expand = true;

                        let timeoutId = null;
                        slider.connect('notify::value', () => {
                            if (timeoutId) GLib.source_remove(timeoutId);
                            timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                                let haBrightness = Math.round(slider.value * 255);
                                haRequest(url, token, '/api/services/light/turn_on', 'POST', { 
                                    entity_id: light.entity_id, 
                                    brightness: haBrightness 
                                }).catch(e => console.error(`[HomeAssistant Ext] Fallo al cambiar brillo: ${e.message}`));
                                
                                timeoutId = null;
                                return GLib.SOURCE_REMOVE;
                            });
                        });

                        sliderItem.add_child(slider);
                        
                        // Ocultamos el slider de entrada si la luz está apagada
                        sliderItem.visible = isOn;

                        this._lightsSection.addMenuItem(sliderItem);
                    }

                    // 3. Conectamos el evento del switch para ocultar/mostrar el slider dinámicamente
                    switchItem.connect('toggled', (item, state) => {
                        let service = state ? 'turn_on' : 'turn_off';
                        
                        // Mostrar u ocultar al instante
                        if (sliderItem) {
                            sliderItem.visible = state;
                            
                            // Detalle extra: Si prendes la luz y el slider estaba en 0, 
                            // lo mandamos a la mitad para que no parezca roto
                            if (state && slider.value === 0) {
                                slider.value = 0.5; 
                            }
                        }

                        haRequest(url, token, `/api/services/light/${service}`, 'POST', { entity_id: light.entity_id })
                            .catch(e => console.error(`[HomeAssistant Ext] Fallo al cambiar estado: ${e.message}`));
                    });
                });
            }
        } catch (error) {
            this._lightsSection.removeAll();
            console.error(`[HomeAssistant Ext] Falló _loadLights: ${error.message}`);
            this._lightsSection.addMenuItem(new PopupMenu.PopupMenuItem('Error conectando a HA. Mira los logs.', { reactive: false }));
        }
    }
});

// --- INDICADOR DEL SISTEMA ---
const HAIndicator = GObject.registerClass(
class HAIndicator extends SystemIndicator {
    constructor(settings) {
        super();
        this._indicator = this._addIndicator();
        this._indicator.iconName = 'lightbulb-symbolic';

        this.toggle = new HALightsToggle(settings);
        
        this.toggle.bind_property('checked',
            this._indicator, 'visible',
            GObject.BindingFlags.SYNC_CREATE);
            
        this.quickSettingsItems.push(this.toggle);
    }
});

// --- CLASE PRINCIPAL DE LA EXTENSIÓN ---
export default class HomeAssistantExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new HAIndicator(this._settings);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.quickSettingsItems.forEach(item => item.destroy());
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
    }
}
