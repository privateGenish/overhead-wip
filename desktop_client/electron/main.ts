import { app, BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initGlobalDb, closeGlobalDb, getAppSetting, setAppSetting } from './db/globalDb'
import {
  initProjectManager,
  openProject,
  closeProject,
  resolveBootProject,
  ensureDefaultProject,
  setVaultTicketListener,
} from './project/projectManager'
import { registerGeneralAPI } from './ipc/generalAPI'
import { registerAppSettingsAPI } from './ipc/appSettingsAPI'
import { registerTicketAPI, flushHistory } from './ipc/ticketAPI'
import { registerNoteAPI } from './ipc/noteAPI'
import { registerPendingAPI } from './ipc/pendingAPI'
import { registerHistoryAPI } from './ipc/historyAPI'
import { registerRelationsAPI } from './ipc/relationsAPI'
import { registerGraphAPI } from './ipc/graphAPI'
import { registerProjectAPI, notifyProjectChanged } from './ipc/projectAPI'
import { notifyTicketUpdated } from './ipc/notify'
import { initToken } from './transports/token'
import { startHttpServer, stopHttpServer } from './transports/http'
import { startUnixServer, stopUnixServer } from './transports/unix'
import { initDeepLinks, handleSecondInstanceArgv, setDeepLinkWindow } from './deepLink'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

const WINDOW_BOUNDS_KEY = 'window.bounds'
const DEFAULT_SIZE = { width: 1200, height: 800 }

let win: BrowserWindow | null = null

interface Bounds { x: number; y: number; width: number; height: number }

/**
 * Restores the last window position, falling back to centred on the primary
 * display. Bounds are discarded when they no longer intersect any display, so
 * unplugging a monitor can't strand the window offscreen.
 */
function restoreBounds(): Bounds | null {
  const raw = getAppSetting(WINDOW_BOUNDS_KEY)
  if (!raw) return null

  try {
    const bounds = JSON.parse(raw) as Bounds
    const visible = screen.getAllDisplays().some((display) => {
      const a = display.workArea
      return (
        bounds.x < a.x + a.width &&
        bounds.x + bounds.width > a.x &&
        bounds.y < a.y + a.height &&
        bounds.y + bounds.height > a.y
      )
    })
    return visible ? bounds : null
  } catch {
    return null
  }
}

function persistBounds(): void {
  if (!win || win.isDestroyed() || win.isMinimized()) return
  const { x, y, width, height } = win.getBounds()
  setAppSetting(WINDOW_BOUNDS_KEY, JSON.stringify({ x, y, width, height }))
}

function createWindow() {
  const saved = restoreBounds()

  win = new BrowserWindow({
    ...DEFAULT_SIZE,
    ...(saved ?? {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
  })

  if (!saved) win.center()

  win.on('resized', persistBounds)
  win.on('moved', persistBounds)

  // Links are held until this window's renderer subscribes — including the one
  // that launched the app, which arrived long before there was a window.
  setDeepLinkWindow(win)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Two instances would contend over the same database, unix socket and vault
// watcher, so a second launch focuses the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Must run before `whenReady`: on macOS a cold-start link is delivered as an
  // `open-url` event that fires earlier than that, and a handler registered
  // afterwards never sees it.
  initDeepLinks()

  app.on('second-instance', (_event, argv) => {
    // Windows/Linux hand a warm link to the running instance as argv.
    handleSecondInstanceArgv(argv)
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(() => {
    const userData = app.getPath('userData')

    initGlobalDb(path.join(userData, 'global.db'))
    initProjectManager(userData, notifyProjectChanged)
    setVaultTicketListener(notifyTicketUpdated)

    // Resolve which project to enter; bootstrap one on first run so the app is
    // usable before the launcher UI exists.
    const project = resolveBootProject() ?? ensureDefaultProject()
    openProject(project.uuid)

    registerGeneralAPI()
    registerAppSettingsAPI()
    registerTicketAPI()
    registerNoteAPI()
    registerPendingAPI()
    registerHistoryAPI()
    registerRelationsAPI()
    registerGraphAPI()
    registerProjectAPI()

    initToken(userData)
    startHttpServer()
    startUnixServer(userData)
    createWindow()
  })
}

app.on('before-quit', () => {
  persistBounds()
  flushHistory()
  stopHttpServer()
  stopUnixServer()
  void closeProject()
  closeGlobalDb()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
  win = null
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
