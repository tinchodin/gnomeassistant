# GNOME Assistant

GNOME Shell extension to control Home Assistant from Quick Settings.

<img width="407" height="1042" alt="Screenshot From 2026-03-12 11-17-47" src="https://github.com/user-attachments/assets/22cefc8a-b11e-45e4-8bad-24b037756aa5" />

## What This Project Does

`GNOME Assistant` adds Home Assistant controls to the GNOME panel, integrated into the Quick Settings menu.

The extension automatically detects Home Assistant entities, groups them by area, and creates toggles to control lights, climate devices, and media players without opening a browser.

## Technologies Used

- GNOME Shell Extension API
- GJS (JavaScript for GNOME)
- Libadwaita / GTK4 (preferences UI)
- GSettings + XML schema
- Soup 3 (HTTP requests to Home Assistant)
- GNOME Shell CSS for visual styling

## Main Features

- Home Assistant connection via URL + Long-Lived Access Token.
- Automatic discovery for `light.*`, `climate.*`, and `media_player.*` entities.
- Automatic grouping by Home Assistant areas.
- Per-area toggles with expandable menus.
- Device-specific controls (lights: on/off and brightness).
- Device-specific controls (climate: on/off, target temperature, and HVAC modes).
- Device-specific controls (media players: on/off, volume, and transport controls).
- Quick hide with right-click (areas or entities).
- Per-area custom icon configuration.
- Optional visual separator between native Quick Settings and extension controls.
- Optional home button in the separator that opens the configured Home Assistant URL.
- State refresh whenever the Quick Settings menu is opened.

## Requirements

- GNOME Shell 45, 46, 47, 48, or 49.
- A reachable Home Assistant instance.
- A valid Home Assistant long-lived access token.

## Local Installation

1. Copy the extension folder to:
`~/.local/share/gnome-shell/extensions/gnomeassistant@tinchodin.uy`
2. Compile schemas:
`glib-compile-schemas ~/.local/share/gnome-shell/extensions/gnomeassistant@tinchodin.uy/schemas`
3. Enable the extension:
`gnome-extensions enable gnomeassistant@tinchodin.uy`

## Configuration

From extension preferences:

- `Server URL`: Home Assistant base URL.
- `Access Token`: Long-lived access token.
- `Ignored items`: Comma-separated areas or entity IDs to hide.
- `Show separator`: Show/hide the visual separator.
- `Icon Customization`: Select icons per discovered area.

## Disclaimer

This project was built with the help of Artificial Intelligence (AI), including support for implementation, UI refinements, and documentation.
