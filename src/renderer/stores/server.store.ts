/**
 * Server Store - Multi-server connection management for Capacitor mobile app.
 *
 * Manages a list of Halo desktop servers the mobile app can connect to.
 * Each server entry stores its URL, auth token, and display name.
 * Persisted to localStorage so the list survives app restarts.
 *
 * Only used in Capacitor mode — Electron and Remote browser modes ignore this store.
 */

import { create } from 'zustand'
import { setActiveServerUrl, setAuthToken } from '../api/transport'

declare const __HALO_DEFAULT_SERVER_URL__: string | undefined
declare const __HALO_DEFAULT_SERVER_TOKEN__: string | undefined

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServerEntry {
  /** Unique identifier (nanoid-style short id) */
  id: string
  /** User-visible name, e.g. "Office Mac Mini" or hostname derived from server URL */
  name: string
  /** Server base URL, e.g. "http://192.168.1.10:3456" */
  url: string
  /** Auth token obtained during PIN login */
  token: string
  /** Timestamp when this server was first added */
  addedAt: number
}

export interface ServerStore {
  /** All saved servers */
  servers: ServerEntry[]
  /** ID of the currently active server (null = none selected) */
  activeId: string | null

  // --- Actions ---

  /** Add a new server to the list and activate it */
  addServer: (entry: Omit<ServerEntry, 'id' | 'addedAt'>) => ServerEntry
  /** Remove a server by ID. If it was active, clears activeId. */
  removeServer: (id: string) => void
  /** Set the active server by ID */
  setActive: (id: string) => void
  /** Clear active server (go back to server list) */
  clearActive: () => void
  /** Get the currently active server entry, or null */
  getActive: () => ServerEntry | null
  /** Update a server entry (e.g. rename, update token) */
  updateServer: (id: string, updates: Partial<Pick<ServerEntry, 'name' | 'token' | 'url'>>) => void
  /** Load persisted state from localStorage */
  hydrate: () => void
}

// ---------------------------------------------------------------------------
// localStorage keys
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'halo_servers'
const ACTIVE_KEY = 'halo_active_server'
const EMBEDDED_SERVER_ID = 'build-default'

/**
 * Private APK builds may carry a one-time bootstrap server. The values come
 * from vite.config.mobile.ts build environment variables, never tracked source.
 * A user who removes the entry gets a persisted [] and it is not recreated.
 */
function embeddedDefaultServer(): ServerEntry | null {
  const url = typeof __HALO_DEFAULT_SERVER_URL__ === 'string'
    ? __HALO_DEFAULT_SERVER_URL__.replace(/\/+$/, '')
    : ''
  const token = typeof __HALO_DEFAULT_SERVER_TOKEN__ === 'string'
    ? __HALO_DEFAULT_SERVER_TOKEN__
    : ''
  if (!url || !token) return null

  let name = 'Halo'
  try { name = new URL(url).hostname } catch { /* build input is validated by connection flow */ }
  return { id: EMBEDDED_SERVER_ID, name, url, token, addedAt: 0 }
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function persistServers(servers: ServerEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers))
  } catch { /* ignore quota errors */ }
}

function persistActiveId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(ACTIVE_KEY, id)
    } else {
      localStorage.removeItem(ACTIVE_KEY)
    }
  } catch { /* ignore */ }
}

function loadServers(): ServerEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const embedded = embeddedDefaultServer()
      return embedded ? [embedded] : []
    }
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? (embeddedDefaultServer() ? EMBEDDED_SERVER_ID : null)
  } catch {
    return null
  }
}

/** Generate a short random ID (8 chars, good enough for local use) */
function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useServerStore = create<ServerStore>((set, get) => ({
  servers: [],
  activeId: null,

  addServer: (entry) => {
    const newEntry: ServerEntry = {
      ...entry,
      id: generateId(),
      addedAt: Date.now(),
    }

    // Check for duplicate URL — update token/name instead of adding duplicate
    const existing = get().servers.find(s => s.url === entry.url)
    if (existing) {
      console.log(`[ServerStore] Server with URL ${entry.url} already exists (id=${existing.id}), updating`)
      const updated = get().servers.map(s =>
        s.id === existing.id
          ? { ...s, name: entry.name, token: entry.token }
          : s
      )
      set({ servers: updated, activeId: existing.id })
      persistServers(updated)
      persistActiveId(existing.id)
      setActiveServerUrl(existing.url)
      setAuthToken(entry.token)
      return { ...existing, name: entry.name, token: entry.token }
    }

    const updated = [...get().servers, newEntry]
    set({ servers: updated, activeId: newEntry.id })
    persistServers(updated)
    persistActiveId(newEntry.id)
    setActiveServerUrl(newEntry.url)
    setAuthToken(newEntry.token)
    console.log(`[ServerStore] Added server: ${newEntry.name} (${newEntry.url}), id=${newEntry.id}`)
    return newEntry
  },

  removeServer: (id) => {
    const updated = get().servers.filter(s => s.id !== id)
    const wasActive = get().activeId === id
    const newActiveId = wasActive ? null : get().activeId
    set({ servers: updated, activeId: newActiveId })
    persistServers(updated)
    persistActiveId(newActiveId)
    if (wasActive) setActiveServerUrl(null)
    console.log(`[ServerStore] Removed server: ${id}`)
  },

  setActive: (id) => {
    const server = get().servers.find(s => s.id === id)
    if (!server) {
      console.warn(`[ServerStore] Cannot activate unknown server: ${id}`)
      return
    }
    set({ activeId: id })
    persistActiveId(id)
    setActiveServerUrl(server.url)
    setAuthToken(server.token)
    console.log(`[ServerStore] Activated server: ${server.name} (${server.url})`)
  },

  clearActive: () => {
    set({ activeId: null })
    persistActiveId(null)
    setActiveServerUrl(null)
    console.log('[ServerStore] Cleared active server')
  },

  getActive: () => {
    const { servers, activeId } = get()
    if (!activeId) return null
    return servers.find(s => s.id === activeId) ?? null
  },

  updateServer: (id, updates) => {
    const updated = get().servers.map(s =>
      s.id === id ? { ...s, ...updates } : s
    )
    set({ servers: updated })
    persistServers(updated)
    console.log(`[ServerStore] Updated server: ${id}`)
  },

  hydrate: () => {
    const servers = loadServers()
    const activeId = loadActiveId()
    const validActiveId = servers.some(s => s.id === activeId) ? activeId : null
    set({ servers, activeId: validActiveId })
    // Push active server URL + token to transport layer
    const active = validActiveId ? servers.find(s => s.id === validActiveId) ?? null : null
    setActiveServerUrl(active?.url ?? null)
    if (active) setAuthToken(active.token)
    console.log(`[ServerStore] Hydrated: ${servers.length} servers, active=${validActiveId}`)
  },
}))
