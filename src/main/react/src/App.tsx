import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react'
import { ConfigProvider, theme, Tabs, Input, Select, Button, Table, Tag, Badge, Space, Typography, Spin, App as AntApp } from 'antd'
import {
  SearchOutlined,
  SyncOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  ClearOutlined,
  SunOutlined,
  MoonOutlined,
} from '@ant-design/icons'
import type { PkgEntry, InstalledPkg } from './api'
import {
  useParuCheck,
  useSearch,
  useInstalledPackages,
  useInstallPackage,
  useRemovePackage,
  useSync,
  useUpgrade,
  useCleanCache,
  useCommandLog,
  sendCommandInput,
} from './api'

const { Title, Text } = Typography

// ---------------------------------------------------------------------------
// Theme detection and toggle
// ---------------------------------------------------------------------------

// localStorage can throw SecurityError when the page is loaded from an
// opaque origin (about:blank / data:), so guard every access.
const themeStore = {
  get(): 'light' | 'dark' | null {
    try {
      const v = localStorage.getItem('aurui-theme')
      return v === 'light' || v === 'dark' ? v : null
    } catch {
      return null
    }
  },
  set(v: 'light' | 'dark') {
    try { localStorage.setItem('aurui-theme', v) } catch { /* ignore */ }
  },
}

function useTheme(): ['light' | 'dark', () => void] {
  // Check saved preference first, then system preference
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
    const saved = themeStore.get()
    if (saved) return saved
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light'
    return 'dark'
  })

  // Listen for system changes if no manual override
  useEffect(() => {
    if (themeStore.get()) return // Manual override active
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const handler = (e: MediaQueryListEvent) => setThemeMode(e.matches ? 'light' : 'dark')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const toggle = useCallback(() => {
    setThemeMode(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      themeStore.set(next)
      return next
    })
  }, [])

  return [themeMode, toggle]
}

// ---------------------------------------------------------------------------
// Theme definitions
// ---------------------------------------------------------------------------

const baseThemeConfig = {
  token: {
    borderRadius: 6,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
}

const darkThemeConfig = {
  ...baseThemeConfig,
  algorithm: theme.darkAlgorithm,
  token: {
    ...baseThemeConfig.token,
    colorPrimary: '#89b4fa',
  },
  components: {
    Table: {
      headerBg: '#313244',
      rowHoverBg: '#45475a',
    },
  },
}

const lightThemeConfig = {
  ...baseThemeConfig,
  algorithm: theme.defaultAlgorithm,
  token: {
    ...baseThemeConfig.token,
    colorPrimary: '#1677ff',
  },
  components: {
    Table: {
      headerBg: '#fafafa',
      rowHoverBg: '#e6f7ff',
    },
  },
}

// ---------------------------------------------------------------------------
// useContainerHeight hook - recalculates on dependency change
// ---------------------------------------------------------------------------

function useContainerHeight(
  ref: React.RefObject<HTMLDivElement | null>,
  recalcKey?: unknown,
  enabled = true,
) {
  const [height, setHeight] = useState(0)
  const frameRefs = useRef<number[]>([])

  const cancelScheduledRecalc = useCallback(() => {
    frameRefs.current.forEach((frame) => window.cancelAnimationFrame(frame))
    frameRefs.current = []
  }, [])

  const recalc = useCallback(() => {
    const node = ref.current
    if (!node || !enabled) return

    const nextHeight = node.getBoundingClientRect().height
    if (nextHeight > 0) {
      setHeight((prev) => prev === nextHeight ? prev : nextHeight)
    }
  }, [enabled, ref])

  const scheduleRecalc = useCallback(() => {
    cancelScheduledRecalc()
    recalc()

    const firstFrame = window.requestAnimationFrame(() => {
      recalc()
      const secondFrame = window.requestAnimationFrame(recalc)
      frameRefs.current.push(secondFrame)
    })
    frameRefs.current.push(firstFrame)
  }, [cancelScheduledRecalc, recalc])

  useEffect(() => {
    if (!ref.current) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const nextHeight = entry.contentRect.height
        if (nextHeight > 0) {
          setHeight((prev) => prev === nextHeight ? prev : nextHeight)
        }
      }
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [ref])

  useLayoutEffect(() => {
    if (!enabled) {
      cancelScheduledRecalc()
      return
    }

    scheduleRecalc()
    window.addEventListener('resize', scheduleRecalc)
    window.visualViewport?.addEventListener('resize', scheduleRecalc)

    return () => {
      window.removeEventListener('resize', scheduleRecalc)
      window.visualViewport?.removeEventListener('resize', scheduleRecalc)
      cancelScheduledRecalc()
    }
  }, [enabled, recalcKey, scheduleRecalc, cancelScheduledRecalc])

  return height
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [tab, setTab] = useState<string>('search')
  const [systemTheme, toggleTheme] = useTheme()
  const themeConfig = systemTheme === 'dark' ? darkThemeConfig : lightThemeConfig
  const isDark = systemTheme === 'dark'

  // Update CSS variables based on theme
  useEffect(() => {
    document.documentElement.style.setProperty('--bg-primary', isDark ? '#1e1e2e' : '#ffffff')
    document.documentElement.style.setProperty('--bg-secondary', isDark ? '#313244' : '#f5f5f5')
    document.documentElement.style.setProperty('--bg-tertiary', isDark ? '#45475a' : '#d9d9d9')
    document.documentElement.style.setProperty('--text-primary', isDark ? '#cdd6f4' : '#262626')
    document.documentElement.style.setProperty('--text-secondary', isDark ? '#a6adc8' : '#8c8c8c')
    document.documentElement.style.setProperty('--border-color', isDark ? '#45475a' : '#d9d9d9')
    document.body.style.background = isDark ? '#1e1e2e' : '#ffffff'
    document.body.style.color = isDark ? '#cdd6f4' : '#262626'
  }, [isDark])

  return (
    <ConfigProvider theme={themeConfig}>
      <AntApp>
        <div
          className="h-screen flex flex-col transition-colors duration-200"
          style={{ background: isDark ? '#1e1e2e' : '#ffffff' }}
        >
          {/* Header */}
          <header
            className="flex items-center justify-between px-[18px] py-2 shrink-0 transition-colors duration-200"
            style={{ background: isDark ? '#313244' : '#f5f5f5', borderBottom: `1px solid ${isDark ? '#45475a' : '#d9d9d9'}` }}
          >
            <Title level={4} className="!m-0" style={{ color: isDark ? '#89b4fa' : '#1677ff' }}>AurUI</Title>
            <HeaderActions onSwitchTab={setTab} isDark={isDark} onToggleTheme={toggleTheme} />
          </header>

          {/* Content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <Tabs
              activeKey={tab}
              onChange={setTab}
              destroyOnHidden={false}
              animated={false}
              className="h-full"
              classNames={{ body: 'aur-tabs-body', content: 'aur-tabs-content' }}
              tabBarStyle={{ margin: 0, paddingLeft: 12, background: isDark ? '#313244' : '#fafafa' }}
              items={[
                { key: 'search',    label: 'Search',     children: <SearchTab isDark={isDark} activeTab={tab} /> },
                { key: 'installed', label: 'Installed',  children: <InstalledTab isDark={isDark} activeTab={tab} /> },
                { key: 'logs',      label: 'Logs',       forceRender: true, children: <LogsTab isDark={isDark} /> },
              ]}
            />
          </div>
        </div>
      </AntApp>
    </ConfigProvider>
  )
}

// ---------------------------------------------------------------------------
// Header actions
// ---------------------------------------------------------------------------

function HeaderActions({ onSwitchTab, isDark, onToggleTheme }: { onSwitchTab: (t: string) => void; isDark: boolean; onToggleTheme: () => void }) {
  const { data: hasParu } = useParuCheck()
  const sync   = useSync()
  const upgrade = useUpgrade()
  const clean  = useCleanCache()

  return (
    <Space size={8}>
      <Badge
        count={hasParu ? 'paru ✓' : 'paru ✗'}
        showZero
        style={{ backgroundColor: hasParu ? '#1a3a1a' : '#3a1a1a', color: hasParu ? '#a6e3a1' : '#f38ba8' }}
      />
      <Button
        icon={isDark ? <SunOutlined /> : <MoonOutlined />}
        onClick={onToggleTheme}
      >
        {isDark ? 'Light' : 'Dark'}
      </Button>
      <Button icon={<SyncOutlined />} loading={sync.isPending} onClick={() => { onSwitchTab('logs'); sync.mutate() }}>Sync</Button>
      <Button icon={<CloudUploadOutlined />} loading={upgrade.isPending} onClick={() => { onSwitchTab('logs'); upgrade.mutate() }} type="primary">Upgrade</Button>
      <Button icon={<ClearOutlined />} loading={clean.isPending} onClick={() => { onSwitchTab('logs'); clean.mutate() }} danger>Cache</Button>
    </Space>
  )
}

// ---------------------------------------------------------------------------
// Search tab
// ---------------------------------------------------------------------------

function SearchTab({ isDark, activeTab }: { isDark: boolean; activeTab: string }) {
  const { data: hasParu } = useParuCheck()
  const search = useSearch()
  const { mutate: installPackage, isPending: isInstalling, variables: installVars } = useInstallPackage()
  const containerRef = useRef<HTMLDivElement>(null)
  const containerHeight = useContainerHeight(
    containerRef,
    activeTab === 'search' ? 'active' : 'inactive',
    activeTab === 'search',
  )

  const [query, setQuery] = useState('')
  const [source, setSource] = useState<'official' | 'aur'>('official')
  const [results, setResults] = useState<PkgEntry[]>([])

  const doSearch = () => {
    if (!query.trim()) return
    search.mutate({ query: query.trim(), source })
  }

  // Sync mutation results into local state so clear can reset instantly.
  useEffect(() => {
    if (search.data) setResults(search.data)
  }, [search.data])

  const columns = useMemo(() => [
    { title: 'Repo',    dataIndex: 'repo',       key: 'repo',       width: 90,
      render: (t: string) => <Tag color={isDark ? 'default' : 'blue'}>{t}</Tag> },
    { title: 'Package', dataIndex: 'name',       key: 'name', width: 200 },
    { title: 'Version', dataIndex: 'version',    key: 'version',    width: 120 },
    { title: 'Status',  dataIndex: 'installed',  key: 'installed',  width: 100,
      render: (v: boolean) => v ? <Tag color="green">installed</Tag> : null },
    { title: 'Description', dataIndex: 'description', key: 'desc', ellipsis: true },
    { title: '', key: 'action', width: 90, fixed: 'right' as const,
      render: (_: unknown, record: PkgEntry) => (
        <Button
          type="primary"
          disabled={record.installed}
          loading={isInstalling && installVars?.name === record.name}
          onClick={() => { installPackage({ name: record.name, source }) }}
        >
          {record.installed ? 'Installed' : 'Install'}
        </Button>
      ),
    },
  ], [installPackage, isDark, isInstalling, source])

  const tableScrollY = Math.max(160, containerHeight - 52)

  return (
    <div ref={containerRef} className="h-full flex flex-col">
      <div className="flex gap-2 px-3 py-3 shrink-0">
        <Input.Search
          placeholder="Search packages…"
          allowClear
          enterButton={<><SearchOutlined /> Search</>}
          loading={search.isPending}
          className="max-w-[520px]"
          value={query}
          onChange={(e) => {
            const v = e.target.value
            setQuery(v)
            if (!v.trim()) setResults([])
          }}
          onSearch={doSearch}
        />
        <Select
          value={source}
          onChange={setSource}
          className="w-[140px]"
          options={[
            { value: 'official', label: 'Official repos' },
            { value: 'aur', label: 'AUR', disabled: !hasParu },
          ]}
        />
      </div>
      <div className="flex-1 overflow-hidden px-3 pb-3">
        <Table
          dataSource={results}
          columns={columns}
          rowKey={(r) => `${r.repo}/${r.name}`}
          pagination={false}
          virtual
          scroll={{ x: 'max-content', y: tableScrollY, scrollToFirstRowOnChange: false }}
          locale={{ emptyText: search.isSuccess ? 'No results.' : 'Type a query and press Search.' }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Installed tab — virtualizes the local package list for performance
// ---------------------------------------------------------------------------

function InstalledTab({ isDark, activeTab }: { isDark: boolean; activeTab: string }) {
  const { data: pkgs, isLoading, refetch } = useInstalledPackages()
  const { mutate: removePackage, isPending: isRemoving, variables: removeVars } = useRemovePackage()
  const tableAreaRef = useRef<HTMLDivElement>(null)
  const [filterText, setFilterText] = useState('')
  // Recalculate when this tab becomes active
  const tableAreaHeight = useContainerHeight(
    tableAreaRef,
    activeTab === 'installed' ? 'active' : 'inactive',
    activeTab === 'installed',
  )

  const filteredPkgs = useMemo(() => {
    if (!pkgs) return []
    const q = filterText.trim().toLowerCase()
    if (!q) return pkgs
    return pkgs.filter((p) => p.name.toLowerCase().includes(q))
  }, [pkgs, filterText])

  const columns = useMemo(() => [
    { title: 'Package', dataIndex: 'name', key: 'name', width: 320, ellipsis: true },
    { title: 'Version', dataIndex: 'version', key: 'version', width: 180, ellipsis: true },
    { title: '', key: 'action', width: 110,
      render: (_: unknown, record: InstalledPkg) => (
        <Button
          danger
          icon={<DeleteOutlined />}
          loading={isRemoving && removeVars === record.name}
          onClick={() => removePackage(record.name)}
        >
          Remove
        </Button>
      ),
    },
  ], [isRemoving, removePackage])

  const tableScrollY = Math.max(160, tableAreaHeight - 40)

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b shrink-0" style={{ borderColor: isDark ? '#45475a' : '#d9d9d9' }}>
        <Space>
          <Input.Search
            placeholder="Filter packages…"
            allowClear
            className="w-56"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            onSearch={(v) => setFilterText(v)}
          />
          <Button icon={<SyncOutlined />} loading={isLoading} onClick={() => refetch()}>Refresh</Button>
          {pkgs && <Text type="secondary" className="text-xs">{filteredPkgs.length}/{pkgs.length} packages</Text>}
        </Space>
      </div>
      <div ref={tableAreaRef} className="flex-1 min-h-0 overflow-hidden px-3 pb-3">
        <Spin spinning={isLoading}>
          <Table
            dataSource={filteredPkgs}
            columns={columns}
            rowKey={(r) => r.name}
            pagination={false}
            virtual
            scroll={{ x: 610, y: tableScrollY, scrollToFirstRowOnChange: false }}
          />
        </Spin>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Logs tab
// ---------------------------------------------------------------------------

function LogsTab({ isDark }: { isDark: boolean }) {
  const { lines, cmd, running } = useCommandLog()
  const [commandInput, setCommandInput] = useState('')
  const [sendingInput, setSendingInput] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [lines])

  const submitInput = async () => {
    if (!running || sendingInput) return

    const input = commandInput
    setCommandInput('')
    setSendingInput(true)
    try {
      await sendCommandInput(`${input}\n`)
    } finally {
      setSendingInput(false)
    }
  }

  return (
    <div className="h-full flex flex-col p-3 gap-2">
      {cmd && (
        <pre className="text-xs px-2.5 py-1.5 rounded-md whitespace-pre-wrap break-all shrink-0"
          style={{ color: isDark ? '#89b4fa' : '#1677ff', background: isDark ? '#313244' : '#f5f5f5' }}>
          {cmd}
        </pre>
      )}
      <div className="flex-1 overflow-y-auto rounded-md p-2.5" style={{ background: isDark ? '#181825' : '#f0f0f0' }}>
        {lines.map((l, i) => (
          <pre key={i} className="font-mono text-xs whitespace-pre-wrap break-all leading-relaxed m-0"
            style={{ color: isDark ? '#a6adc8' : '#595959' }}>{l}</pre>
        ))}
        <div ref={endRef} />
      </div>
      <Space.Compact className="shrink-0">
        <Input
          value={commandInput}
          disabled={!running}
          placeholder={running ? 'Input to command' : 'No running command'}
          onChange={(e) => setCommandInput(e.target.value)}
          onPressEnter={(e) => {
            e.preventDefault()
            void submitInput()
          }}
        />
        <Button
          type="primary"
          disabled={!running}
          loading={sendingInput}
          onClick={() => void submitInput()}
        >
          Send
        </Button>
      </Space.Compact>
      {lines.length === 0 && <Text type="secondary" className="text-center py-3">No output yet. Run an operation from the toolbar above.</Text>}
    </div>
  )
}
