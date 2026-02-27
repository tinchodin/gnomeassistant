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

// API request helper
function haRequest(url, token, endpoint, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        if (!url || !token) {
            return reject(new Error('Missing credentials'));
        }

        let cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        let fullPath = `${cleanUrl}${endpoint}`;

        let session = new Soup.Session();
        let message = Soup.Message.new(method, fullPath);

        if (!message) return reject(new Error('Malformed URL'));

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

// Per-area toggle
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
        this._timeoutIds = new Set();

        this.menu.setHeader(iconName, areaName);
        this._buildEntities();

        this.connect('destroy', () => this._clearTimeouts());

        // Main action: toggle all lights in this area
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

    _addTimeout(delayMs, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._timeoutIds.delete(id);
            return callback();
        });
        this._timeoutIds.add(id);
        return id;
    }

    _removeTimeout(id) {
        if (!id) return;
        if (this._timeoutIds.has(id)) {
            this._timeoutIds.delete(id);
            GLib.source_remove(id);
        }
    }

    _clearTimeouts() {
        for (const id of this._timeoutIds) {
            GLib.source_remove(id);
        }
        this._timeoutIds.clear();
    }

    _buildEntities() {
        let url = this._settings.get_string('ha-url');
        let token = this._settings.get_string('ha-token');

        let anyLightOn = false;

        this._areaEntities.forEach(entity => {
            let name = entity.attributes.friendly_name || entity.entity_id;
            let isLight = entity.entity_id.startsWith('light.');
            let isClimate = entity.entity_id.startsWith('climate.');
            let isMedia = entity.entity_id.startsWith('media_player.');
            let isOn = (isClimate || isMedia) ? (entity.state !== 'off' && entity.state !== 'unavailable') : (entity.state === 'on');
            
            if (isLight && isOn) anyLightOn = true;

            let attrs = entity.attributes || {};
            let switchItem = new PopupMenu.PopupSwitchMenuItem(name, isOn);
            
            // Use consistent device icons and enforce a 16px size
            let deviceIconName = 'emoji-objects-symbolic'; // Light bulb icon
            if (isClimate) deviceIconName = 'power-profile-power-saver-symbolic';
            if (isMedia) deviceIconName = 'applications-multimedia-symbolic';

            let deviceIcon = new St.Icon({
                icon_name: deviceIconName,
                icon_size: 16,
                style_class: 'popup-menu-icon'
            });
            switchItem.insert_child_at_index(deviceIcon, 0);

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
            let brightLabel = null;
            let modeItem = null;
            let modeButtons = null;
            let playIcon = null;

            if (isLight) {
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

                    let percent = Math.round((currentBrightness / 255) * 100);
                    brightLabel = new St.Label({
                        text: `${percent}%`,
                        y_align: Clutter.ActorAlign.CENTER,
                        style: 'margin-left: 10px; font-weight: bold;'
                    });

                    let timeoutId = null;
                    slider.connect('notify::value', () => {
                        if (this._syncing) return;

                        let p = Math.round(slider.value * 100);
                        brightLabel.set_text(`${p}%`);

                        if (timeoutId) this._removeTimeout(timeoutId);
                        timeoutId = this._addTimeout(300, () => {
                            let haBrightness = Math.round(slider.value * 255);
                            haRequest(url, token, '/api/services/light/turn_on', 'POST', {
                                entity_id: entity.entity_id, brightness: haBrightness
                            }).catch(e => console.error(`[HA Ext] Brightness update failed: ${e.message}`));
                            timeoutId = null;
                            return GLib.SOURCE_REMOVE;
                        });
                    });

                    sliderItem.add_child(slider);
                    sliderItem.add_child(brightLabel);
                    sliderItem.visible = isOn;
                    
                    this.menu.addMenuItem(sliderItem);
                }
            } else if (isClimate) {
                let minTemp = attrs.min_temp !== undefined ? attrs.min_temp : 16;
                let maxTemp = attrs.max_temp !== undefined ? attrs.max_temp : 32;
                let range = (maxTemp - minTemp) || 1;

                let currentTemp = attrs.temperature !== undefined ? attrs.temperature : minTemp;
                currentTemp = Math.max(minTemp, Math.min(maxTemp, currentTemp));

                sliderItem = new PopupMenu.PopupBaseMenuItem({ activate: false });
                let icon = new St.Icon({ icon_name: 'power-profile-power-saver-symbolic', style_class: 'popup-menu-icon' });
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

                    if (timeoutId) this._removeTimeout(timeoutId);
                    timeoutId = this._addTimeout(400, () => {
                        haRequest(url, token, '/api/services/climate/set_temperature', 'POST', {
                            entity_id: entity.entity_id, temperature: temp
                        }).catch(e => console.error(`[HA Ext] Temperature update failed: ${e.message}`));
                        timeoutId = null;
                        return GLib.SOURCE_REMOVE;
                    });
                });

                sliderItem.add_child(slider);
                sliderItem.add_child(tempLabel);
                sliderItem.visible = isOn;
                this.menu.addMenuItem(sliderItem);

                let modes = Array.isArray(attrs.hvac_modes) ? attrs.hvac_modes : [];
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
                            }).catch(e => console.error(`[HA Ext] HVAC mode update failed: ${e.message}`));
                        });

                        modeButtons[mode] = btn;
                        modeBox.add_child(btn);
                    });

                    modeItem.add_child(modeBox);
                    modeItem.visible = isOn;
                    this.menu.addMenuItem(modeItem);
                }
            } else if (isMedia) {
                let currentVolume = attrs.volume_level !== undefined ? attrs.volume_level : 0;

                sliderItem = new PopupMenu.PopupBaseMenuItem({ activate: false });
                let icon = new St.Icon({ icon_name: 'audio-volume-high-symbolic', style_class: 'popup-menu-icon' });
                sliderItem.add_child(icon);

                slider = new Slider(currentVolume);
                slider.x_expand = true;

                brightLabel = new St.Label({
                    text: `${Math.round(currentVolume * 100)}%`,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'margin-left: 10px; font-weight: bold;'
                });

                let timeoutId = null;
                slider.connect('notify::value', () => {
                    if (this._syncing) return;

                    let p = Math.round(slider.value * 100);
                    brightLabel.set_text(`${p}%`);

                    if (timeoutId) this._removeTimeout(timeoutId);
                    timeoutId = this._addTimeout(300, () => {
                        haRequest(url, token, '/api/services/media_player/volume_set', 'POST', {
                            entity_id: entity.entity_id, volume_level: slider.value
                        }).catch(e => console.error(`[HA Ext] Volume update failed: ${e.message}`));
                        timeoutId = null;
                        return GLib.SOURCE_REMOVE;
                    });
                });

                sliderItem.add_child(slider);
                sliderItem.add_child(brightLabel);
                sliderItem.visible = isOn;
                this.menu.addMenuItem(sliderItem);

                modeItem = new PopupMenu.PopupBaseMenuItem({ activate: false });
                let modeBox = new St.BoxLayout({ x_expand: true });
                modeBox.style = 'padding: 4px 12px; margin-bottom: 6px;';

                let createMediaBtn = (iconName, service) => {
                    let btn = new St.Button({ style_class: 'button', can_focus: true, x_expand: true });
                    btn.style = 'margin: 0 4px; border-radius: 8px; padding: 4px;';

                    let btnIcon = new St.Icon({ icon_name: iconName, icon_size: 16 });
                    btnIcon.x_align = Clutter.ActorAlign.CENTER;
                    btn.set_child(btnIcon);

                    btn.connect('clicked', () => {
                        if (service === 'media_play_pause') {
                            let isPlaying = btnIcon.icon_name === 'media-playback-pause-symbolic';
                            btnIcon.icon_name = isPlaying ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic';
                        }

                        haRequest(url, token, `/api/services/media_player/${service}`, 'POST', { entity_id: entity.entity_id })
                            .catch(e => console.error(`[HA Ext] Media action failed (${service}): ${e.message}`));
                    });
                    return { btn, btnIcon };
                };

                let prevBtn = createMediaBtn('media-skip-backward-symbolic', 'media_previous_track');

                let playIconName = entity.state === 'playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
                let playPauseWrap = createMediaBtn(playIconName, 'media_play_pause');
                playIcon = playPauseWrap.btnIcon;

                let nextBtn = createMediaBtn('media-skip-forward-symbolic', 'media_next_track');

                modeBox.add_child(prevBtn.btn);
                modeBox.add_child(playPauseWrap.btn);
                modeBox.add_child(nextBtn.btn);

                modeItem.add_child(modeBox);
                modeItem.visible = isOn;
                this.menu.addMenuItem(modeItem);
            }

            switchItem.connect('toggled', (item, state) => {
                if (this._syncing) return;
                let domain = isClimate ? 'climate' : (isMedia ? 'media_player' : 'light');
                let service = state ? 'turn_on' : 'turn_off';

                if (sliderItem) {
                    sliderItem.visible = state;
                    if (state && slider.value === 0 && isLight) slider.value = 0.5;
                }
                if (modeItem) modeItem.visible = state;

                let areaAnyLightOn = false;
                for (let id in this._entityWidgets) {
                    let w = this._entityWidgets[id];
                    let widgetState = (id === entity.entity_id) ? state : (w.switchItem.state || false);
                    if (w.isLight && widgetState) {
                        areaAnyLightOn = true;
                        break;
                    }
                }

                this._syncing = true;
                this.checked = areaAnyLightOn;
                this._syncing = false;

                haRequest(url, token, `/api/services/${domain}/${service}`, 'POST', { entity_id: entity.entity_id })
                    .then(response => {
                        if (isClimate && state) {
                            let applyClimateState = (newState) => {
                                if (!newState || !newState.state) return;
                                if (modeButtons) {
                                    for (let m in modeButtons) modeButtons[m].set_checked(false);
                                    if (modeButtons[newState.state]) modeButtons[newState.state].set_checked(true);
                                }
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

                            let updatedEntity = Array.isArray(response) ? response.find(e => e.entity_id === entity.entity_id) : null;
                            if (updatedEntity && updatedEntity.state && updatedEntity.state !== 'off') {
                                applyClimateState(updatedEntity);
                            } else {
                                this._addTimeout(500, () => {
                                    haRequest(url, token, `/api/states/${entity.entity_id}`)
                                        .then(applyClimateState)
                                        .catch(err => {});
                                    return GLib.SOURCE_REMOVE;
                                });
                            }
                        }
                    })
                    .catch(e => console.error(`[HA Ext] State update failed: ${e.message}`));
            });

            this._entityWidgets[entity.entity_id] = { switchItem, sliderItem, slider, tempLabel, brightLabel, modeItem, modeButtons, playIcon, isLight, isClimate, isMedia };
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
                .then(() => {
                    if (targetState) {
                        this._addTimeout(500, () => {
                            haRequest(url, token, '/api/states')
                                .then(states => this.updateStates(states))
                                .catch(e => {});
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                })
                .catch(e => console.error(`[HA Ext] Bulk light toggle failed: ${e.message}`));
        }

        this._areaEntities.forEach(entity => {
            if (entity.entity_id.startsWith('light.')) {
                let widgets = this._entityWidgets[entity.entity_id];
                if (widgets && widgets.switchItem.setToggleState) {
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
                let isMedia = widgets.isMedia;
                let isLight = widgets.isLight;
                let isOn = (isClimate || isMedia) ? (s.state !== 'off' && s.state !== 'unavailable') : (s.state === 'on');

                if (isLight && isOn) anyLightOn = true;

                if (widgets.switchItem.setToggleState) {
                    widgets.switchItem.setToggleState(isOn);
                }

                if (widgets.sliderItem) {
                    widgets.sliderItem.visible = isOn;
                    if (isOn) {
                        if (isLight && s.attributes.brightness !== undefined) {
                            widgets.slider.value = s.attributes.brightness / 255;
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
                        } else if (isMedia && s.attributes.volume_level !== undefined) {
                            widgets.slider.value = s.attributes.volume_level;
                            if (widgets.brightLabel) {
                                let p = Math.round(s.attributes.volume_level * 100);
                                widgets.brightLabel.set_text(`${p}%`);
                            }
                        }
                    }
                }

                if (widgets.modeItem) {
                    widgets.modeItem.visible = isOn;
                    if (isClimate && widgets.modeButtons) {
                        for (let m in widgets.modeButtons) {
                            widgets.modeButtons[m].set_checked(s.state === m);
                        }
                    } else if (isMedia && widgets.playIcon) {
                        widgets.playIcon.icon_name = s.state === 'playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
                    }
                }
            }
        });

        this.checked = anyLightOn;
        this._syncing = false;
    }
});

// System indicator container
const HAIndicator = GObject.registerClass(
class HAIndicator extends SystemIndicator {
    constructor() {
        super();
        this._indicator = this._addIndicator();
        this._indicator.iconName = 'lightbulb-symbolic';
        this._indicator.visible = false;
    }
});

// Main extension class
export default class HomeAssistantExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._areaToggles = [];
        this._indicator = null;
        this._quickSettingsSeparator = null;
        this._separatorSignalId = null;

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
                    console.error(`[HA Ext] Failed to refresh global states: ${e.message}`);
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

        this._separatorSignalId = this._settings.connect('changed::show-separator', () => {
            this._destroyLayout();
            this._buildLayout();
        });
    }

    _destroyLayout() {
        if (this._quickSettingsSeparator) {
            this._quickSettingsSeparator.destroy();
            this._quickSettingsSeparator = null;
        }

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
        let showSeparator = true;
        try {
            showSeparator = this._settings.get_boolean('show-separator');
        } catch (e) {}

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
                let isMedia = s.entity_id.startsWith('media_player.');
                if (!isLight && !isClimate && !isMedia) return false;
                if (ignoredList.includes(s.entity_id.toLowerCase())) return false;
                return true;
            });

            if (entities.length === 0) return;

            let areaMap = {};
            try {
                const templateStr = "{% set ns = namespace(items={}) %}{% for s in states.light %}{% set a = area_name(s.entity_id) %}{% if a %}{% set ns.items = dict(ns.items, **{s.entity_id: a}) %}{% endif %}{% endfor %}{% for s in states.climate %}{% set a = area_name(s.entity_id) %}{% if a %}{% set ns.items = dict(ns.items, **{s.entity_id: a}) %}{% endif %}{% endfor %}{% for s in states.media_player %}{% set a = area_name(s.entity_id) %}{% if a %}{% set ns.items = dict(ns.items, **{s.entity_id: a}) %}{% endif %}{% endfor %}{{ ns.items | to_json }}";
                areaMap = await haRequest(url, token, '/api/template', 'POST', { template: templateStr });
            } catch (e) {}

            const groupedEntities = {};
            entities.forEach(entity => {
                let area = areaMap[entity.entity_id] || 'Other';
                if (!groupedEntities[area]) groupedEntities[area] = [];
                groupedEntities[area].push(entity);
            });

            const sortedAreas = Object.keys(groupedEntities).sort((a, b) => {
                if (a === 'Other') return 1;
                if (b === 'Other') return -1;
                return a.localeCompare(b);
            });

            let discoveredStr = sortedAreas.join(',');
            if (this._settings.get_string('discovered-areas') !== discoveredStr) {
                this._settings.set_string('discovered-areas', discoveredStr);
            }

            this._indicator = new HAIndicator();

            sortedAreas.forEach(area => {
                if (ignoredList.includes(area.toLowerCase())) return;

                // Apply a fallback icon for each area when none is configured
                let iconName = customIcons[area] || 'emoji-objects-symbolic';

                let toggle = new HAAreaToggle(area, groupedEntities[area], iconName, this._settings);
                this._areaToggles.push(toggle);
                this._indicator.quickSettingsItems.push(toggle);
            });

            Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

            if (showSeparator && this._areaToggles.length > 0) {
                const homeButton = new St.Button({
                    style_class: 'icon-button flat ha-quick-settings-home-button',
                    can_focus: true,
                    reactive: true,
                    track_hover: true,
                    y_align: Clutter.ActorAlign.CENTER,
                    child: new St.Icon({
                        icon_name: 'go-home-symbolic',
                        style_class: 'ha-quick-settings-separator-icon popup-menu-icon',
                    }),
                });
                homeButton.connect('clicked', () => this._openHomeAssistantUrl());

                const line = new St.Widget({
                    style_class: 'popup-separator-menu-item-separator',
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });

                this._quickSettingsSeparator = new St.BoxLayout({
                    style_class: 'popup-separator-menu-item ha-quick-settings-separator',
                    reactive: false,
                    can_focus: false,
                    track_hover: false,
                    x_expand: true,
                });
                this._quickSettingsSeparator.add_child(homeButton);
                this._quickSettingsSeparator.add_child(line);

                Main.panel.statusArea.quickSettings.menu.insertItemBefore(
                    this._quickSettingsSeparator,
                    this._areaToggles[0],
                    2
                );
            }

        } catch (e) {
            console.error(`[HA Ext] _buildLayout failed: ${e.message}`);
        }
    }

    _openHomeAssistantUrl() {
        let url = '';
        try {
            url = this._settings.get_string('ha-url').trim();
        } catch (e) {
            return;
        }

        if (!url) return;
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
            url = `http://${url}`;
        }

        try {
            Gio.app_info_launch_default_for_uri(url, global.create_app_launch_context(0, -1));
        } catch (e) {
            console.error(`[HA Ext] Failed to open Home Assistant URL: ${e.message}`);
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
        if (this._separatorSignalId) {
            this._settings.disconnect(this._separatorSignalId);
            this._separatorSignalId = null;
        }
        this._destroyLayout();
        this._settings = null;
    }
}
