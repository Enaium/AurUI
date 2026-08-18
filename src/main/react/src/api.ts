import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PkgEntry {
  repo: string
  name: string
  version: string
  installed: boolean
  description: string
}

export interface InstalledPkg {
  name: string
  version: string
}

// ---------------------------------------------------------------------------
// Webview binding declarations
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    search: (...args: unknown[]) => Promise<unknown>
    listInstalled: (...args: unknown[]) => Promise<unknown>
    install: (...args: unknown[]) => Promise<unknown>
    remove: (...args: unknown[]) => Promise<unknown>
    sync: (...args: unknown[]) => Promise<unknown>
    upgrade: (...args: unknown[]) => Promise<unknown>
    cleanCache: (...args: unknown[]) => Promise<unknown>
    commandInput: (...args: unknown[]) => Promise<unknown>
    checkParu: (...args: unknown[]) => Promise<unknown>
    getEmbeddedHtml: (...args: unknown[]) => Promise<unknown>
    onCommandOutput: (line: string) => void
    onCommandDone: (exitCode: number) => void
    onCommandStart: (cmd: string) => void
    onInstalledPackagesChunk: (requestId: string, chunk: string, done: boolean, error?: string) => void
  }
}

// ---------------------------------------------------------------------------
// TanStack Query hooks
// ---------------------------------------------------------------------------

/** Check whether paru (AUR helper) is installed. */
export function useParuCheck() {
  return useQuery({
    queryKey: ['paru'],
    queryFn: async () => {
      // returnResult parses JSON → JS receives the actual boolean/string.
      const raw = await window.checkParu()
      return raw === true || raw === 'true'
    },
  })
}

/** Search packages (official repos or AUR). Manual trigger via mutate. */
export function useSearch() {
  return useMutation({
    mutationFn: async ({
      query,
      source,
    }: {
      query: string
      source: 'official' | 'aur'
    }) => {
      // returnResult parses the JSON array before it reaches JS,
      // so we receive the parsed array directly — no JSON.parse needed.
      const result = await window.search(query, source)
      return Array.isArray(result) ? (result as PkgEntry[]) : []
    },
  })
}

/** List all locally installed packages. */
type InstalledStream = {
  chunks: string[]
  resolve: (pkgs: InstalledPkg[]) => void
  reject: (error: Error) => void
  timeout: number
}

const _installedStreams = new Map<string, InstalledStream>()
let _installedRequestSeq = 0

function cleanupInstalledStream(requestId: string) {
  const pending = _installedStreams.get(requestId)
  if (!pending) return

  window.clearTimeout(pending.timeout)
  _installedStreams.delete(requestId)
}

window.onInstalledPackagesChunk = (requestId: string, chunk: string, done: boolean, error?: string) => {
  const pending = _installedStreams.get(requestId)
  if (!pending) return

  if (error) {
    cleanupInstalledStream(requestId)
    pending.reject(new Error(error))
    return
  }

  if (!done) {
    pending.chunks.push(chunk)
    return
  }

  const raw = pending.chunks.join('')
  cleanupInstalledStream(requestId)

  try {
    const parsed = JSON.parse(raw)
    pending.resolve(Array.isArray(parsed) ? (parsed as InstalledPkg[]) : [])
  } catch (e) {
    pending.reject(e instanceof Error ? e : new Error(String(e)))
  }
}

async function listInstalledPackages(): Promise<InstalledPkg[]> {
  const requestId = `installed-${Date.now()}-${++_installedRequestSeq}`

  const streamed = new Promise<InstalledPkg[]>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanupInstalledStream(requestId)
      reject(new Error('Timed out while loading installed packages'))
    }, 60_000)

    _installedStreams.set(requestId, { chunks: [], resolve, reject, timeout })
  })

  try {
    const result = await window.listInstalled(requestId)
    if (Array.isArray(result)) {
      cleanupInstalledStream(requestId)
      return result as InstalledPkg[]
    }
  } catch (e) {
    cleanupInstalledStream(requestId)
    throw e
  }

  return streamed
}

export function useInstalledPackages() {
  return useQuery({
    queryKey: ['installed'],
    queryFn: listInstalledPackages,
    // Avoid re-running `pacman -Q` (and re-rendering the whole list) on every
    // tab switch / window focus. Still invalidated by install/remove success.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}

/** Install a single package. Invalidates the installed list on success. */
export function useInstallPackage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      name,
      source,
    }: {
      name: string
      source: 'official' | 'aur'
    }) => {
      const result = await window.install(name, source)
      return typeof result === 'number' ? result : 0
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['installed'] }),
  })
}

/** Remove a package. Invalidates the installed list on success. */
export function useRemovePackage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const result = await window.remove(name)
      return typeof result === 'number' ? result : 0
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['installed'] }),
  })
}

/** Sync databases (pacman -Sy). */
export function useSync() {
  return useMutation({
    mutationFn: async () => {
      const result = await window.sync()
      return typeof result === 'number' ? result : 0
    },
  })
}

/** Full system upgrade. */
export function useUpgrade() {
  return useMutation({
    mutationFn: async () => {
      const result = await window.upgrade()
      return typeof result === 'number' ? result : 0
    },
  })
}

/** Clean package cache. */
export function useCleanCache() {
  return useMutation({
    mutationFn: async () => {
      const result = await window.cleanCache()
      return typeof result === 'number' ? result : 0
    },
  })
}

export async function sendCommandInput(input: string) {
  const result = await window.commandInput(input)
  return result === true || result === 'true'
}

// ---------------------------------------------------------------------------
// Streaming command log (module-level so events are never lost before mount)
// ---------------------------------------------------------------------------

type LogListener = (lines: string[], cmd: string | null, running: boolean) => void

let _logLines: string[] = []
let _logCmd: string | null = null
let _logRunning = false
let _logListeners: LogListener[] = []

function notifyLogListeners() {
  const lines = [..._logLines]
  const cmd = _logCmd
  const running = _logRunning
  _logListeners.forEach((cb) => cb(lines, cmd, running))
}

window.onCommandOutput = (line: string) => {
  _logLines = [..._logLines, line]
  notifyLogListeners()
}
window.onCommandStart = (cmd: string) => {
  _logLines = []
  _logCmd = cmd
  _logRunning = true
  notifyLogListeners()
}
window.onCommandDone = (code: number) => {
  _logCmd = _logCmd ? `${_logCmd}  —  exit ${code}` : _logCmd
  _logRunning = false
  notifyLogListeners()
}

/** Subscribe to the shared command log stream. */
export function useCommandLog() {
  const [lines, setLines] = useState(_logLines)
  const [cmd, setCmd] = useState(_logCmd)
  const [running, setRunning] = useState(_logRunning)

  useEffect(() => {
    const sync = (nextLines: string[], nextCmd: string | null, nextRunning: boolean) => {
      setLines(nextLines)
      setCmd(nextCmd)
      setRunning(nextRunning)
    }
    _logListeners.push(sync)
    sync(_logLines, _logCmd, _logRunning)
    return () => { _logListeners = _logListeners.filter((cb) => cb !== sync) }
  }, [])

  return { lines, cmd, running }
}
