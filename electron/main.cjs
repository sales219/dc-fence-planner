const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 950,
    minWidth: 1100,
    minHeight: 760,
    title: 'DC Fence Planner',
    backgroundColor: '#f4f7f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL('http://127.0.0.1:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('dialog:saveProject', async (_event, payload) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save DC Fence Planner project',
    defaultPath: `${payload?.jobName || 'dc-fence-project'}.dcfence.json`,
    filters: [{ name: 'DC Fence Planner Project', extensions: ['dcfence.json', 'json'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { canceled: false, filePath };
});

ipcMain.handle('dialog:openProject', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Open DC Fence Planner project',
    properties: ['openFile'],
    filters: [{ name: 'Project Files', extensions: ['dcfence.json', 'json'] }],
  });
  if (canceled || !filePaths?.[0]) return { canceled: true };
  const contents = await fs.readFile(filePaths[0], 'utf8');
  return { canceled: false, filePath: filePaths[0], project: JSON.parse(contents) };
});
