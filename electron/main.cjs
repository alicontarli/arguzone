const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');

const isDev = !app.isPackaged; 

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#202225',
    title: "ArguZone Beta",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Preload yan komşusu olduğu için yolu aynı kalır
      preload: path.join(__dirname, 'preload.cjs')
    },
    autoHideMenuBar: true,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // DÜZELTME: electron klasöründen çıkıp (../) dist klasörüne gitmeliyiz
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  globalShortcut.register('Alt+M', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
       mainWindow.webContents.send('global-mute-toggle');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', (e) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        e.preventDefault(); 
        mainWindow.webContents.send('app-closing');
        setTimeout(() => { app.exit(0); }, 1000); 
    }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});