/**
 * `overhead://` links, from the OS to the renderer.
 *
 * Three arrival paths, one destination:
 *
 * - **macOS** delivers every link through the `open-url` event, cold or warm.
 *   The cold-start one fires *before* `app.whenReady()`, so `initDeepLinks()`
 *   is called at module scope in `main.ts` rather than inside `whenReady` —
 *   registering later means never seeing the link that launched the app.
 * - **Windows/Linux** put the URL in `process.argv` on a cold start, and in the
 *   `second-instance` argv when the app is already running.
 * - Either way the URL is forwarded over IPC to the renderer, which owns the
 *   route.
 *
 * A link almost always arrives before there is anything to show it to — the
 * window may not exist, and the renderer certainly has not subscribed yet — so
 * links are buffered until a renderer says it is listening, and flushed then.
 * Dropping a cold-start link is the failure mode this module exists to prevent.
 */

import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

/** Renderer-bound channel carrying one URL. */
const OPEN_CHANNEL = 'deep-link:open'
/** Renderer→main: "a listener is attached, send me anything you buffered." */
const READY_CHANNEL = 'deep-link:ready'

const SCHEME = 'overhead'
const PREFIX = `${SCHEME}://`

/** Links that arrived before a renderer could receive them. */
let pending: string[] = []
let target: BrowserWindow | null = null
let rendererReady = false

/**
 * Finds the deep link in a process argv, or null.
 *
 * Scanned back-to-front: the launcher appends the URL after the app's own
 * arguments, and in dev those arguments include paths and switches of their own.
 */
export function extractDeepLink(argv: readonly string[]): string | null {
  for (let i = argv.length - 1; i >= 0; i--) {
    const arg = argv[i]
    if (typeof arg !== 'string') continue
    const trimmed = arg.trim()
    if (trimmed.toLowerCase().startsWith(PREFIX)) return trimmed
  }
  return null
}

/**
 * Claims `overhead://` for this app.
 *
 * In dev the running binary is Electron itself, so the OS has to be told which
 * script to relaunch it with — otherwise it registers bare `electron` and the
 * link opens an empty shell instead of Overhead.
 */
function registerProtocol(): void {
  if (process.defaultApp) {
    const entry = process.argv[1]
    if (entry) {
      app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(entry)])
      return
    }
  }
  app.setAsDefaultProtocolClient(SCHEME)
}

/**
 * Registers the protocol and every arrival path. Call at module scope, before
 * `app.whenReady()` — see the note on `open-url` above.
 */
export function initDeepLinks(): void {
  registerProtocol()

  app.on('open-url', (event, url) => {
    event.preventDefault()
    deliverDeepLink(url)
  })

  // The renderer subscribes on mount; that is the first moment a link can
  // actually be shown, so it is also when the buffer is drained.
  ipcMain.on(READY_CHANNEL, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) target = win
    rendererReady = true
    flush()
  })

  // Windows/Linux cold start: the URL is just another argument.
  const fromArgv = extractDeepLink(process.argv)
  if (fromArgv) deliverDeepLink(fromArgv)
}

/**
 * Points delivery at the app window. The renderer has not subscribed yet at
 * this point, so links stay buffered until it does — including across a dev
 * reload, which drops the old subscription.
 */
export function setDeepLinkWindow(win: BrowserWindow): void {
  target = win
  rendererReady = false
}

/** Sends a URL to the renderer, or buffers it until one is listening. */
export function deliverDeepLink(url: string): void {
  pending.push(url)
  focusWindow()
  flush()
}

/** Handles the argv of a `second-instance` launch. Windows/Linux warm path. */
export function handleSecondInstanceArgv(argv: readonly string[]): void {
  const url = extractDeepLink(argv)
  if (url) deliverDeepLink(url)
}

export function __resetDeepLinksForTests(): void {
  pending = []
  target = null
  rendererReady = false
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function flush(): void {
  if (!rendererReady || !target || target.isDestroyed()) return
  const queued = pending
  pending = []
  for (const url of queued) target.webContents.send(OPEN_CHANNEL, url)
}

/** A link means the user asked for this window — put it in front of them. */
function focusWindow(): void {
  if (!target || target.isDestroyed()) return
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
}
