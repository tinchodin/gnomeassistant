import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { QuickMenuToggle, SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js';
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';

// --- FUNCIÓN DE PETICIÓN A LA API ---
function haRequest(url, token, endpoint, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        if (!url || !token) {
            return reject(new Error('Faltan credenciales'));
        }

        let cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        let fullPath = `${cleanUrl}${endpoint}`;

        let session = new Soup.Session();
        let message = Soup.Message.new(method, fullPath);

        if (!message) return reject(new Error('URL mal formateada'));

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
                    reject(new Error(`Error HTTP ${status}`));
                    return;
                }

                let decoder = new TextDecoder('utf-8');
                let responseStr = decoder.decode(bytes.get_data());
                resolve(JSON.parse(responseStr));
            } catch (e) {
                reject(e);
            }
        });
    });
}

// --- BOTÓN INDIVIDUAL POR ÁREA ---
const HAAreaToggle = GObject.registerClass(
class HAAreaToggle extends QuickMenuToggle {
    constructor(areaName, areaEntities, iconName, settings) {
        super({
            title: areaName,
            iconName: iconName,
            toggleMode: true,
        });

        this._settings = settings;
        this._areaEntities = areaEntities;
        this._entityWidgets = {};
        this._syncing = false;

        this.menu.setHeader(iconName, areaName);
        this._buildEntities();

        // ACCIÓN PRINCIPAL: Toggle de toda el área (SOLO LUCES)
        this.connect('notify::checked', () => {
            if (this._syncing) return;
            const targetState = this.checked;
            this._toggleAll(targetState);
        });

        this.connect('button-press-event', (actor, event) => {
            if (event.get_button() === 3) {
                let ignoredStr = this._settings.get_string('ignored-items');
                let ignoredList = ignoredStr.split(',').map(s => s.trim()).filter(s => s.length > 0);

                if (!ignoredList.includes(areaName)) {
                    ignoredList.push(areaName);
                    this._settings.set_string('ignored-items', ignoredList.join(', '));
                }
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _buildEntities() {
        let url = this._settings.get_string('ha-url');
        let token = this._settings.get_string('ha-token');

        let anyLightOn = false;

        this._areaEntities.forEach(entity => {
            let name = entity.attributes.friendly_name || entity.entity_id;
            let isClimate = entity.entity_id.startsWith('climate.');
            let isOn = isClimate ? (entity.state !== 'off' && entity.state !== 'unavailable') : (entity.state === 'on');
            
            if (!isClimate && isOn) anyLightOn = true;

            let attrs = entity.attributes || {};
            let switchItem = new PopupMenu.PopupSwitchMenuItem(name, isOn);
            
            // Reemplazo seguro de activate para evitar cierre de menú
            switchItem.activate = function(event) {
                this.toggle();
            };

            switchItem.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 3) {
                    let ignoredStr = this._settings.get_string('ignored-items');
                    let ignoredList = ignoredStr.split(',').map(s => s.trim()).filter(s => s.length > 0);

                    if (!ignoredList.includes(entity.entity_id)) {
                        ignoredList.push(entity.entity_id);
                        this._settings.set_string('ignored-items', ignoredList.join(', '));
                    }
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            this.menu.addMenuItem(switchItem);

            let sliderItem = null;
            let slider = null;
            let tempLabel = null;
            let brightLabel = null; // NUEVO: Para el % de luces
            let modeItem = null;
            let modeButtons = null;

            if (!isClimate) {
                // --- LÓGICA DE LUCES (Brillo) ---
                let supportsBrightness = false;
                if ('brightness' in attrs && attrs.brightness !== null) supportsBrightness = true;
                else if (attrs.supported_color_modes && attrs.supported_color_modes.some(m => m !== 'onoff' && m !== 'unknown')) supportsBrightness = true;
                else if (attrs.supported_features !== undefined && (attrs.supported_features & 1)) supportsBrightness = true;

                if (supportsBrightness) {
                    let currentBrightness = attrs.brightness || 0;
                    sliderItem = new PopupMenu.PopupBaseMenuItem({ activate: false });
                    let icon = new St.Icon({ icon_name: 'display-brightness-symbolic', style_class: 'popup-menu-icon' });
                    sliderItem.add_child(icon);

                    slider = new Slider(currentBrightness / 255);
                    slider.x_expand = true;

                    // NUEVO: Etiqueta de porcentaje de brillo
                    let percent = Math.round((currentBrightness / 255) * 100);
                    brightLabel = new St.Label({
                        text: `${percent}%`,
                        y_align: Clutter.ActorAlign.CENTER,
                        style: 'margin-left: 10px; font-weight: bold;'
                    });

                    let timeoutId = null;
                    slider.connect('notify::value', () => {
                        if (this._syncing) return;

                        // Actualizar texto en tiempo real
                        let p = Math.round(slider.value * 100);
                        brightLabel.set_text(`${p}%`);

                        if (timeoutId) GLib.source_remove(timeoutId);
                        timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                            let haBrightness = Math.round(slider.value * 255);
                            haRequest(url, token, '/api/services/light/turn_on', 'POST', {
                                entity_id: entity.entity_id, brightness: haBrightness
                            }).catch(e => console.error(`[HA Ext] Fallo brillo: ${e.message}`));
                            timeoutId = null;
                            return GLib.SOURCE_REMOVE;
                        });
                    });

                    sliderItem.add_child(slider);
                    sliderItem.add_child(brightLabel); // Agregamos la etiqueta
                    sliderItem.visible = isOn;
                    
                    this.menu.addMenuItem(sliderItem);
                }
            } else {
                // --- LÓGICA DE CLIMA (Temperatura y Modos) ---
                let minTemp = attrs.min_temp !== undefined ? attrs.min_temp : 16;
                let maxTemp = attrs.max_temp !== undefined ? attrs.max_temp : 32;
                let range = (maxTemp - minTemp) || 1; // Previene divisiones por cero

                let currentTemp = attrs.temperature !== undefined ? attrs.temperature : minTemp;
                currentTemp = Math.max(minTemp, Math.min(maxTemp, currentTemp));

                sliderItem = new PopupMenu.PopupBaseMenuItem({ activate: false });
                // CAMBIO: Ícono solicitado
                let icon = new St.Icon({ icon_name: 'power-profile-performance-symbolic', style_class: 'popup-menu-icon' });
                sliderItem.add_child(icon);

                let initialSliderValue = (currentTemp - minTemp) / range;
                slider = new Slider(Math.max(0, Math.min(1, initialSliderValue)));
                slider.x_expand = true;

                tempLabel = new St.Label({
                    text: `${currentTemp}°`,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'margin-left: 10px; font-weight: bold;'
                });

                let timeoutId = null;
                slider.connect('notify::value', () => {
                    if (this._syncing) return;

                    let temp = Math.round(slider.value * range) + minTemp;
                    tempLabel.set_text(`${temp}°`);

                    if (timeoutId) GLib.source_remove(timeoutId);
                    timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                        haRequest(url, token, '/api/services/climate/set_temperature', 'POST', {
                            entity_id: entity.entity_id, temperature: temp
                        }).catch(e => console.error(`[HA Ext] Fallo temperatura: ${e.message}`));
                        timeoutId = null;
                        return GLib.SOURCE_REMOVE;
                    });
                });

                sliderItem.add_child(slider);
                sliderItem.add_child(tempLabel);
                sliderItem.visible = isOn;
                this.menu.addMenuItem(sliderItem);

                // Botones de Modo (Frío, Calor, etc)
                let modes = Array.isArray(attrs.hvac_modes) ? attrs.hvac_modes : [];
                // CAMBIO: Filtramos el modo 'off'
                modes = modes.filter(m => m !== 'off');

                if (modes.length > 0) {
                    modeItem = new PopupMenu.PopupBaseMenuItem({ activate: false });

                    let modeBox = new St.BoxLayout({ x_expand: true });
                    modeBox.style = 'padding: 4px 12px; margin-bottom: 6px;';
                    modeButtons = {};

                    modes.forEach(mode => {
                        let mIcon = 'thermometer-symbolic';
                        if (mode === 'cool') mIcon = 'weather-snow-symbolic';
                        if (mode === 'heat') mIcon = 'weather-clear-symbolic';
                        if (mode === 'auto' || mode === 'heat_cool') mIcon = 'view-refresh-symbolic';
                        if (mode === 'dry') mIcon = 'weather-showers-symbolic';
                        if (mode === 'fan_only') mIcon = 'fan-symbolic';

                        let btn = new St.Button({
                            style_class: 'button',
                            x_expand: true,
                            can_focus: true
                        });
                        btn.set_toggle_mode(true);
                        btn.set_checked(entity.state === mode);
                        btn.style = 'margin: 0 4px; border-radius: 8px; padding: 4px;';

                        let btnIcon = new St.Icon({ icon_name: mIcon, icon_size: 16 });
                        btnIcon.x_align = Clutter.ActorAlign.CENTER;
                        btn.set_child(btnIcon);

                        btn.connect('clicked', () => {
                            for (let m in modeButtons) modeButtons[m].set_checked(false);
                            btn.set_checked(true);

                            if (!switchItem.state) {
                                this._syncing = true;
                                switchItem.setToggleState(true);
                                if (sliderItem) sliderItem.visible = true;
                                if (modeItem) modeItem.visible = true;
                                this._syncing = false;
                            }

                            haRequest(url, token, '/api/services/climate/set_hvac_mode', 'POST', {
                                entity_id: entity.entity_id, hvac_mode: mode
                            }).catch(e => console.error(`[HA Ext] Fallo modo: ${e.message}`));
                        });

                        modeButtons[mode] = btn;
                        modeBox.add_child(btn);
                    });

                    modeItem.add_child(modeBox);
                    modeItem.visible = isOn;
                    this.menu.addMenuItem(modeItem);
                }
            }

            switchItem.connect('toggled', (item, state) => {
                if (this._syncing) return;
                let domain = isClimate ? 'climate' : 'light';
                let service = state ? 'turn_on' : 'turn_off';

                if (sliderItem) {
                    sliderItem.visible = state;
                    if (state && slider.value === 0 && !isClimate) slider.value = 0.5;
                }
                if (modeItem) modeItem.visible = state;

                let areaAnyLightOn = false;
                for (let id in this._entityWidgets) {
                    let w = this._entityWidgets[id];
                    let widgetState = (id === entity.entity_id) ? state : w.switchItem.state;
                    if (!w.isClimate && widgetState) {
                        areaAnyLightOn = true;
                        break;
                    }
                }

                this._syncing = true;
                this.checked = areaAnyLightOn;
                this._syncing = false;

                haRequest(url, token, `/api/services/${domain}/${service}`, 'POST', { entity_id: entity.entity_id })
                    .then(response => {
                        // NUEVO: Al encender el clima, averiguamos en qué modo quedó para pintarlo automáticamente
                        if (isClimate && state) {
                            let applyClimateState = (newState) => {
                                if (!newState || !newState.state) return;
                                // Pintar el botón del modo correcto
                                if (modeButtons) {
                                    for (let m in modeButtons) modeButtons[m].set_checked(false);
                                    if (modeButtons[newState.state]) modeButtons[newState.state].set_checked(true);
                                }
                                // Actualizar temperatura si aplica
                                if (newState.attributes && newState.attributes.temperature && tempLabel && slider) {
                                    let minTemp = newState.attributes.min_temp !== undefined ? newState.attributes.min_temp : 16;
                                    let maxTemp = newState.attributes.max_temp !== undefined ? newState.attributes.max_temp : 32;
                                    let range = (maxTemp - minTemp) || 1;
                                    let currentTemp = Math.max(minTemp, Math.min(maxTemp, newState.attributes.temperature));

                                    this._syncing = true;
                                    slider.value = Math.max(0, Math.min(1, (currentTemp - minTemp) / range));
                                    tempLabel.set_text(`${currentTemp}°`);
                                    this._syncing = false;
                                }
                            };

                            // Intentamos leer el modo directo de la respuesta inmediata
                            let updatedEntity = Array.isArray(response) ? response.find(e => e.entity_id === entity.entity_id) : null;
                            if (updatedEntity && updatedEntity.state && updatedEntity.state !== 'off') {
                                applyClimateState(updatedEntity);
                            } else {
                                // Fallback: consultamos a la API medio segundo después por si la integración del aire es lenta
                                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                                    haRequest(url, token, `/api/states/${entity.entity_id}`)
                                        .then(applyClimateState)
                                        .catch(err => {});
                                    return GLib.SOURCE_REMOVE;
                                });
                            }
                        }
                    })
                    .catch(e => console.error(`[HA Ext] Fallo estado: ${e.message}`));
            });

            this._entityWidgets[entity.entity_id] = { switchItem, sliderItem, slider, tempLabel, brightLabel, modeItem, modeButtons, isClimate };
        });

        this._syncing = true;
        this.checked = anyLightOn;
        this._syncing = false;
    }

    _toggleAll(targetState) {
        let url = this._settings.get_string('ha-url');
        let token = this._settings.get_string('ha-token');
        let service = targetState ? 'turn_on' : 'turn_off';

        let lightIds = this._areaEntities.filter(e => e.entity_id.startsWith('light.')).map(e => e.entity_id);

        if (lightIds.length > 0) {
            haRequest(url, token, `/api/services/light/${service}`, 'POST', { entity_id: lightIds })
                .catch(e => console.error(`[HA Ext] Fallo toggleAll luces: ${e.message}`));
        }

        this._areaEntities.forEach(entity => {
            if (entity.entity_id.startsWith('light.')) {
                let widgets = this._entityWidgets[entity.entity_id];
                if (widgets) {
                    this._syncing = true;
                    widgets.switchItem.setToggleState(targetState);
                    if (widgets.sliderItem) widgets.sliderItem.visible = targetState;
                    this._syncing = false;
                }
            }
        });
    }

    updateStates(states) {
        let anyLightOn = false;
        this._syncing = true;

        states.forEach(s => {
            let widgets = this._entityWidgets[s.entity_id];
            if (widgets) {
                let isClimate = widgets.isClimate;
                let isOn = isClimate ? (s.state !== 'off' && s.state !== 'unavailable') : (s.state === 'on');

                if (!isClimate && isOn) anyLightOn = true;

                widgets.switchItem.setToggleState(isOn);

                if (widgets.sliderItem) {
                    widgets.sliderItem.visible = isOn;
                    if (isOn) {
                        if (!isClimate && s.attributes.brightness) {
                            widgets.slider.value = s.attributes.brightness / 255;
                            // NUEVO: Sincronizar etiqueta de brillo cuando viene de HA
                            if (widgets.brightLabel) {
                                let p = Math.round((s.attributes.brightness / 255) * 100);
                                widgets.brightLabel.set_text(`${p}%`);
                            }
                        } else if (isClimate && s.attributes.temperature) {
                            let minTemp = s.attributes.min_temp !== undefined ? s.attributes.min_temp : 16;
                            let maxTemp = s.attributes.max_temp !== undefined ? s.attributes.max_temp : 32;
                            let range = (maxTemp - minTemp) || 1;
                            let currentTemp = Math.max(minTemp, Math.min(maxTemp, s.attributes.temperature));

                            widgets.slider.value = Math.max(0, Math.min(1, (currentTemp - minTemp) / range));
                            if (widgets.tempLabel) widgets.tempLabel.set_text(`${currentTemp}°`);
                        }
                    }
                }

                if (widgets.modeItem && widgets.modeButtons) {
                    widgets.modeItem.visible = isOn;
                    for (let m in widgets.modeButtons) {
                        widgets.modeButtons[m].set_checked(s.state === m);
                    }
                }
            }
        });

        this.checked = anyLightOn;
        this._syncing = false;
    }
});

// --- INDICADOR DEL SISTEMA (Contenedor invisible) ---
const HAIndicator = GObject.registerClass(
class HAIndicator extends SystemIndicator {
    constructor() {
        super();
        this._indicator = this._addIndicator();
        this._indicator.iconName = 'lightbulb-symbolic';
        this._indicator.visible = false;
    }
});

// --- CLASE PRINCIPAL DE LA EXTENSIÓN ---
export default class HomeAssistantExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._areaToggles = [];
        this._indicator = null;

        this._buildLayout();

        this._menuSignalId = Main.panel.statusArea.quickSettings.menu.connect('open-state-changed', async (menu, isOpen) => {
            if (isOpen) {
                let url = this._settings.get_string('ha-url');
                let token = this._settings.get_string('ha-token');
                if (!url || !token) return;

                try {
                    const states = await haRequest(url, token, '/api/states');
                    this._areaToggles.forEach(toggle => toggle.updateStates(states));
                } catch (e) {
                    console.error(`[HA Ext] Fallo actualizando estados globales: ${e.message}`);
                }
            }
        });

        this._settingsSignalId = this._settings.connect('changed::ignored-items', () => {
            this._destroyLayout();
            this._buildLayout();
        });

        this._iconsSignalId = this._settings.connect('changed::custom-icons', () => {
            this._destroyLayout();
            this._buildLayout();
        });
    }

    _destroyLayout() {
        if (this._indicator) {
            this._areaToggles.forEach(t => t.destroy());
            this._areaToggles = [];
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    async _buildLayout() {
        let url = this._settings.get_string('ha-url');
        let token = this._settings.get_string('ha-token');
        if (!url || !token) return;

        let ignoredStr = "";
        let customIcons = {};
        try {
            ignoredStr = this._settings.get_string('ignored-items');
            customIcons = JSON.parse(this._settings.get_string('custom-icons'));
        } catch (e) {}

        let ignoredList = ignoredStr.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0);

        try {
            const states = await haRequest(url, token, '/api/states');

            const entities = states.filter(s => {
                let isLight = s.entity_id.startsWith('light.');
                let isClimate = s.entity_id.startsWith('climate.');
                if (!isLight && !isClimate) return false;
                if (ignoredList.includes(s.entity_id.toLowerCase())) return false;
                return true;
            });

            if (entities.length === 0) return;

            let areaMap = {};
            try {
                const templateStr = "{% set ns = namespace(items={}) %}{% for s in states.light %}{% set a = area_name(s.entity_id) %}{% if a %}{% set ns.items = dict(ns.items, **{s.entity_id: a}) %}{% endif %}{% endfor %}{% for s in states.climate %}{% set a = area_name(s.entity_id) %}{% if a %}{% set ns.items = dict(ns.items, **{s.entity_id: a}) %}{% endif %}{% endfor %}{{ ns.items | to_json }}";
                areaMap = await haRequest(url, token, '/api/template', 'POST', { template: templateStr });
            } catch (e) {}

            const groupedEntities = {};
            entities.forEach(entity => {
                let area = areaMap[entity.entity_id] || 'Otros';
                if (area === 'Otros') {
                    let parts = entity.entity_id.split('.')[1].split('_');
                    if (parts.length > 1) area = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
                }
                if (!groupedEntities[area]) groupedEntities[area] = [];
                groupedEntities[area].push(entity);
            });

            const sortedAreas = Object.keys(groupedEntities).sort((a, b) => {
                if (a === 'Otros') return 1;
                if (b === 'Otros') return -1;
                return a.localeCompare(b);
            });

            let discoveredStr = sortedAreas.join(',');
            if (this._settings.get_string('discovered-areas') !== discoveredStr) {
                this._settings.set_string('discovered-areas', discoveredStr);
            }

            this._indicator = new HAIndicator();

            sortedAreas.forEach(area => {
                if (ignoredList.includes(area.toLowerCase())) return;

                let iconName = customIcons[area] || 'lightbulb-symbolic';

                let toggle = new HAAreaToggle(area, groupedEntities[area], iconName, this._settings);
                this._areaToggles.push(toggle);
                this._indicator.quickSettingsItems.push(toggle);
            });

            Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        } catch (e) {
            console.error(`[HA Ext] Falló _buildLayout: ${e.message}`);
        }
    }

    disable() {
        if (this._menuSignalId) {
            Main.panel.statusArea.quickSettings.menu.disconnect(this._menuSignalId);
            this._menuSignalId = null;
        }
        if (this._settingsSignalId) {
            this._settings.disconnect(this._settingsSignalId);
            this._settingsSignalId = null;
        }
        if (this._iconsSignalId) {
            this._settings.disconnect(this._iconsSignalId);
            this._iconsSignalId = null;
        }
        this._destroyLayout();
        this._settings = null;
    }
}
