# DC Fence Planner

DC Fence Planner is a standalone Electron + React desktop application for DC Fencing LLC. It is intentionally **not** a WordPress plugin, website integration, or phone app. It saves projects locally on the laptop and can run without internet after installation.

## Features

- Project setup fields for customer, address, phone, email, job name, date, fence type, customer notes, and internal notes.
- Blueprint-style planning workspace with a large drawing toolbar for Upload Aerial Screenshot, Calibrate Scale, Draw Fence Line, Select/Edit, Add Gate, Add Post, Mark Light-Ready Post, Pan, Zoom In, Zoom Out, Fit to Screen, Hide/Show Background, and Clear Drawing.
- Upload PNG, JPG/JPEG, or WebP aerial screenshots as a drawing background.
- Pan, zoom, fit-to-screen, opacity control, hide/show background, and background image locking.
- Scale calibration from a drawn reference line with real feet and inches; calibrated run dimensions display as feet/inches on the drawing.
- Click-to-draw straight and angled fence runs with draggable endpoints, readable run labels, dimension arrows, total footage, manual length overrides, and per-run post spacing.
- Automatic post placement with visible post symbols, editable post type, material/size, notes, and manual post add/move/delete.
- Metal post wording defaults to square tubing unless pipe is specifically selected; post caps are not assumed by default.
- Light-Ready Posts options for +12, +18, +24, +36, and custom extensions. Plans label these as LP-1, LP-2, LP-3, etc. with the legend: `LP = Light-Ready Extended Post for customer-supplied lights.`
- Custom gates including walk, double, sliding, cantilever, and custom gates with labels on the plan. Walk and double gates show swing arcs; cantilever gates include opening, tail, overall length, roller/post, receiver, catch, and bracing fields.
- Material takeoff for total linear feet, fence type footage, posts by type and size, light-ready posts, gates, rails/purlins, panels/sheets, concrete, hinges, latches, fasteners, custom line items, and editable waste percentage.
- Export customer PDF, internal PDF, material takeoff CSV, project JSON, import project JSON, save project file, and open project file.
- Built-in “How to use this app” panel covering the normal workflow from project info through PDF export.

## Development setup

```bash
npm install
npm run dev
```

The development command starts Vite and opens the Electron desktop shell.

## Build the Windows desktop app

From Windows, or from a build environment capable of producing Windows Electron artifacts, run:

```bash
npm install
npm run dist
```

The installer and portable executable are written to the `release/` directory. The Electron Builder configuration creates both an NSIS installer and a portable Windows executable.

For a quick unpacked desktop build on any platform, run:

```bash
npm run dist:dir
```

## Local project files

Use **Save project file** to save a `.dcfence.json` file on the laptop. Use **Open project file** to reopen it later. The app also keeps a browser local-storage autosave while you work.
