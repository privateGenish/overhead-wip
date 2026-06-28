import { app, BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initSqlite } from './db/sqlite'
import { getVaultDir, initVault } from './vault/vaultManager'
import { initVaultWatcher, stopVaultWatcher } from './vault/vaultWatcher'
import { registerGeneralAPI } from './ipc/generalAPI'
import { registerTicketAPI, flushHistory } from './ipc/ticketAPI'
import { registerHistoryAPI } from './ipc/historyAPI'
import { registerRelationsAPI } from './ipc/relationsAPI'
import { registerGraphAPI } from './ipc/graphAPI'
import { notifyTicketUpdated } from './ipc/notify'
import { initToken } from './transports/token'
import { startHttpServer, stopHttpServer } from './transports/http'
import { startUnixServer, stopUnixServer } from './transports/unix'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

let win: BrowserWindow | null = null


function createWindow() {
  const displays = screen.getAllDisplays()
  const target = displays[1] ?? displays[0]
  const { x, y } = target.bounds

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    x: x + Math.round((target.bounds.width - 1200) / 2),
    y: y + Math.round((target.bounds.height - 800) / 2),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  initSqlite(path.join(userData, 'overhead.db'))
  initVault(path.join(userData, 'vault'))
  initVaultWatcher(getVaultDir(), notifyTicketUpdated)
  registerGeneralAPI()
  registerTicketAPI()
  registerHistoryAPI()
  registerRelationsAPI()
  registerGraphAPI()
  initToken(userData)
  startHttpServer()
  startUnixServer(userData)
  createWindow()
})

app.on('before-quit', () => {
  flushHistory()
  stopHttpServer()
  stopUnixServer()
  void stopVaultWatcher()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
  win = null
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
