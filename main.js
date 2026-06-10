const { app, BrowserWindow, ipcMain } = require('electron');
if (process.platform === 'win32') app.commandLine.appendSwitch('no-sandbox');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    title: 'POS Pro',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.once('ready-to-show', () => { mainWindow.show(); });
  mainWindow.webContents.session.clearStorageData({storages: ['serviceworkers']});
  // Sur Windows charger depuis le web, sur Mac charger local
  if (process.platform === 'win32') {
    mainWindow.loadURL('https://caisse.e-plazastore.com');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
  }
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-printers', async () => {
  // Retourner les imprimantes disponibles
  return [];
});

ipcMain.handle('print-ticket', async (event, data) => {
  console.log('=== IMPRESSION ===', data.lines.length, 'lignes');
  try {
    // Vérifier si impression WiFi
    const printerIP = data.printerIP || null;
    
    if (printerIP) {
      // Impression via WiFi TCP
      const net = require('net');
      const chunks = buildESCPOS(data);
      return new Promise((resolve) => {
        const client = new net.Socket();
        client.connect(9100, printerIP, function() {
          client.write(chunks);
          client.destroy();
          resolve({ success: true });
        });
        client.on('error', function(err) {
          resolve({ success: false, error: err.message });
        });
        setTimeout(() => resolve({ success: false, error: 'Timeout' }), 5000);
      });
    }
    
    const usb = require('usb');
    const device = usb.findByIds(0x28e9, 0x0289);
    if (!device) return { success: false, error: 'Imprimante non trouvee' };

    device.open();
    const iface = device.interfaces[0];
    iface.claim();
    const endpoint = iface.endpoints.find(e => e.direction === 'out');
    if (!endpoint) return { success: false, error: 'Endpoint non trouve' };

    const clean = (str) => str
      .replace(/[éèêë]/g,'e').replace(/[àâä]/g,'a')
      .replace(/[îï]/g,'i').replace(/[ôö]/g,'o')
      .replace(/[ùûü]/g,'u').replace(/ç/g,'c')
      .replace(/[^\x00-\x7F]/g,'?');

    var chunks = [Buffer.from([0x1b, 0x40])];

    data.lines.forEach(function(line) {
      if (line.indexOf('__BOLD__') >= 0) {
        var txt = clean(line.replace('__BOLD__','').replace('__/BOLD__','').trim());
        chunks.push(Buffer.from([0x1b,0x45,0x01,0x1b,0x61,0x01,0x1d,0x21,0x11]));
        chunks.push(Buffer.from(txt + '\n', 'ascii'));
        chunks.push(Buffer.from([0x1d,0x21,0x00,0x1b,0x45,0x00,0x1b,0x61,0x00]));
      } else {
        chunks.push(Buffer.from(clean(line) + '\n', 'ascii'));
      }
    });

    if (data.barcode) {
      var bc = String(data.barcode);
      chunks.push(Buffer.from([0x0a,0x1b,0x61,0x01,0x1d,0x68,0x50,0x1d,0x77,0x02,0x1d,0x48,0x02,0x1d,0x6b,0x04]));
      chunks.push(Buffer.from(bc + '\x00', 'ascii'));
      chunks.push(Buffer.from([0x0a,0x1b,0x61,0x00]));
    }

    chunks.push(Buffer.from([0x0a,0x0a,0x1d,0x56,0x41,0x10]));

    var buf = Buffer.concat(chunks);

    return new Promise((resolve) => {
      endpoint.transfer(buf, (err) => {
        try { iface.release(() => device.close()); } catch(e2) {}
        if (err) {
          console.error('Transfer error:', err.message);
          resolve({ success: false, error: err.message });
        } else {
          console.log('Impression OK !');
          resolve({ success: true });
        }
      });
    });
  } catch(e) {
    console.error('Error:', e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('open-external', async (event, url) => {
  const { shell } = require('electron');
  await shell.openExternal(url);
  return { success: true };
});

ipcMain.handle('print-wifi', async (event, data) => {
  console.log('=== IMPRESSION WIFI ===', data.ip);
  try {
    const net = require('net');
    const usb = require('usb');
    
    const clean = (str) => str
      .replace(/[éèêë]/g,'e').replace(/[àâä]/g,'a')
      .replace(/[îï]/g,'i').replace(/[ôö]/g,'o')
      .replace(/[ùûü]/g,'u').replace(/ç/g,'c')
      .replace(/[^\x00-\x7F]/g,'?');

    var chunks = [Buffer.from([0x1b, 0x40])];
    data.lines.forEach(function(line) {
      if (line.indexOf('__BOLD__') >= 0) {
        var txt = clean(line.replace('__BOLD__','').replace('__/BOLD__','').trim());
        chunks.push(Buffer.from([0x1b,0x45,0x01,0x1b,0x61,0x01,0x1d,0x21,0x11]));
        chunks.push(Buffer.from(txt + '\n', 'ascii'));
        chunks.push(Buffer.from([0x1d,0x21,0x00,0x1b,0x45,0x00,0x1b,0x61,0x00]));
      } else {
        chunks.push(Buffer.from(clean(line) + '\n', 'ascii'));
      }
    });
    if (data.barcode) {
      chunks.push(Buffer.from([0x0a,0x1b,0x61,0x01,0x1d,0x68,0x50,0x1d,0x77,0x02,0x1d,0x48,0x02,0x1d,0x6b,0x04]));
      chunks.push(Buffer.from(String(data.barcode) + '\x00', 'ascii'));
    }
    chunks.push(Buffer.from([0x0a,0x0a,0x1d,0x56,0x41,0x10]));
    var buf = Buffer.concat(chunks);

    return new Promise((resolve) => {
      const client = new net.Socket();
      client.connect(9100, data.ip, function() {
        client.write(buf, function() {
          client.destroy();
          console.log('WiFi print OK');
          resolve({ success: true });
        });
      });
      client.on('error', function(err) {
        console.error('WiFi error:', err.message);
        resolve({ success: false, error: err.message });
      });
      setTimeout(() => { client.destroy(); resolve({ success: false, error: 'Timeout' }); }, 5000);
    });
  } catch(e) {
    return { success: false, error: e.message };
  }
});
