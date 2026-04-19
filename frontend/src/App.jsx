import React, { useState, useEffect, useRef, useMemo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { 
  Play, 
  Settings, 
  Terminal, 
  CloudDownload, 
  Upload, 
  Trash2, 
  ChevronLeft, 
  Cpu, 
  HardDrive, 
  Usb,
  Activity,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  LayoutDashboard,
  Database,
  Info,
  Power,
  Package,
  ArrowLeft,
  Zap,
  ChevronUp,
  ChevronDown,
  AlertTriangle
} from 'lucide-react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import './App.css'

// --- Utilities ---
function cn(...inputs) {
  return twMerge(clsx(inputs))
}

const PAYLOAD_EXPLORER_URL = 'https://itsplk.github.io/ps5_payloads/ps5_payloads.json'

// --- Custom Hook for Gamepad Navigation ---
function useGamepadNavigation(view, setView) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      // PS5 Browser maps D-pad to Arrow keys
      const active = document.activeElement
      
      if (e.key === 'ArrowRight') {
        // If sidebar item is focused, move to first content item
        if (active && active.closest('nav')) {
          const contentItems = document.querySelectorAll('main button, main input')
          if (contentItems.length > 0) {
            contentItems[0].focus()
            e.preventDefault()
          }
        }
      }

      if (e.key === 'ArrowLeft') {
        // If content item is focused, move back to active sidebar item
        if (active && active.closest('main')) {
          const sidebarActive = document.querySelector('nav button.bg-ps-blue')
          if (sidebarActive) {
            sidebarActive.focus()
            e.preventDefault()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [view])
}

// --- Global Components ---

const SidebarItem = ({ id, label, icon: Icon, isActive, onClick }) => (
  <button
    onClick={() => onClick(id)}
    className={cn(
      "flex flex-col items-center justify-center w-20 h-20 rounded-xl transition-all duration-300 group relative",
      isActive 
        ? "bg-ps-blue text-white neon-border" 
        : "text-zinc-400 hover:text-white hover:bg-white/10"
    )}
  >
    <Icon className="w-8 h-8" />
    <span className={cn(
      "text-[12px] font-bold mt-1 uppercase tracking-tighter transition-opacity absolute -bottom-6 bg-zinc-800 px-2 py-0.5 rounded pointer-events-none z-50",
      isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus:opacity-100"
    )}>
      {label}
    </span>
    {isActive && (
      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-10 bg-white rounded-l-full shadow-[0_0_10px_white]" />
    )}
  </button>
)

const PayloadCard = ({ path, idx, loading, onLoad, onDelete, showPath = true, showDelete = true }) => {
  const name = path.split('/').pop().replace(/\.(elf|bin|lua)$/i, '').replace(/_/g, ' ')
  const isUSB = path.includes('/mnt/usb')
  const ext = path.split('.').pop().toUpperCase()

  return (
    <div className="animate-fade-in group relative" style={{ animationDelay: `${idx * 50}ms` }}>
      <button
        onClick={() => onLoad(path)}
        disabled={loading}
        className="w-full text-left p-6 glass-card rounded-ps-xl flex flex-col h-full border-white/10"
      >
        <div className="flex items-center justify-between mb-4">
           <div className={cn(
             "px-3 py-1 rounded text-[12px] font-black uppercase tracking-wider",
             isUSB ? 'bg-purple-600 text-white' : 'bg-ps-blue text-white'
           )}>
             {isUSB ? "USB" : "Internal"}
           </div>
           {!showPath && (
             <div className="text-[12px] font-mono text-zinc-300 px-2 border border-zinc-700 rounded bg-white/5">
               {ext}
             </div>
           )}
        </div>
        <h3 className="text-xl font-bold text-white leading-tight mb-3 group-hover:text-ps-blue group-focus:text-ps-blue transition-colors line-clamp-2">
          {name}
        </h3>
        {showPath && (
          <div className="mt-auto">
            <code className="text-[12px] font-mono text-zinc-300 block truncate opacity-70 group-hover:opacity-100 transition-opacity">
              {path}
            </code>
          </div>
        )}
      </button>
      {showDelete && !isUSB && (
        <button 
          onClick={(e) => { e.stopPropagation(); onDelete(path.split('/').pop()); }}
          className="absolute -top-2 -right-2 p-2 bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-red-500 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-all z-10"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      )}
    </div>
  )
}

const Dashboard = ({ ip, version, logs, payloads, setView, loading, onLoad, onDelete }) => (
  <div className="space-y-10 animate-fade-in">
    <div className="flex items-end justify-between">
      <div>
        <h1 className="text-5xl font-black italic text-white uppercase tracking-tighter mb-2">
          Next Menu <span className="text-ps-blue">Dashboard</span>
        </h1>
        <p className="label-caps italic-none text-zinc-300">System overview and quick access</p>
      </div>
      <div className="flex items-center space-x-6 text-right">
        <div className="bg-white/5 border border-white/10 px-6 py-3 rounded-2xl shadow-xl">
          <p className="label-caps !text-[12px] mb-1">Local Address</p>
          <p className="text-2xl font-mono font-black text-ps-blue">{ip}</p>
        </div>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
      <div className="col-span-1 md:col-span-2 glass-card p-8 rounded-ps-2xl bg-gradient-to-br from-ps-card to-ps-surface border-white/10">
         <div className="flex items-center space-x-4 mb-6">
            <Activity className="w-8 h-8 text-ps-blue neon-text" />
            <h2 className="text-2xl font-bold uppercase tracking-tight">Recent Logs</h2>
         </div>
         <div className="space-y-4">
            {logs.slice(-5).reverse().map((log, i) => (
              <div key={i} className="flex items-center space-x-4 p-4 bg-white/5 rounded-xl border border-white/10">
                <div className="w-2.5 h-2.5 rounded-full bg-ps-blue shadow-[0_0_10px_var(--color-ps-blue)]" />
                <p className="text-sm font-mono text-zinc-100 truncate">{log}</p>
              </div>
            ))}
            {logs.length === 0 && (
              <p className="text-zinc-400 text-lg italic">No recent activity detected.</p>
            )}
         </div>
      </div>

      <div className="glass-card p-8 rounded-ps-2xl flex flex-col items-center justify-center text-center space-y-6 border-dashed border-2 border-white/10">
         <div className="p-6 rounded-full bg-ps-blue/10 border border-ps-blue/20">
            <Cpu className="w-10 h-10 text-ps-blue" />
         </div>
         <div>
            <h4 className="label-caps mb-1">Loader Version</h4>
            <p className="text-2xl font-black text-white">{version}</p>
         </div>
         <button 
           onClick={() => setView('payloads')}
           className="w-full mt-4 flex items-center justify-center space-x-3 py-4 bg-ps-blue hover:bg-ps-blue/80 text-white rounded-2xl font-bold text-lg transition-all shadow-lg"
         >
           <span>Launch Payload</span>
           <ArrowRight className="w-5 h-5" />
         </button>
      </div>
    </div>

    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-black uppercase tracking-[0.2em] text-zinc-400">Quick Launch</h3>
        <button onClick={() => setView('payloads')} className="text-md font-bold text-ps-blue hover:underline">View All ({payloads.length})</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
         {payloads.slice(0, 4).map((path, idx) => (
           <PayloadCard key={path} path={path} idx={idx} loading={loading} onLoad={onLoad} onDelete={onDelete} showPath={false} showDelete={false} />
         ))}
      </div>
    </div>
  </div>
)

const ExecutionList = ({ payloads, loading, refreshPayloads, onLoad, onDelete }) => (
  <div className="space-y-8 animate-fade-in">
    <div className="flex items-center justify-between">
      <h2 className="text-5xl font-black text-white uppercase italic tracking-tighter">
        Launch <span className="text-ps-blue">Payload</span>
      </h2>
      <div className="flex items-center space-x-6">
        <span className="label-caps !text-[14px] text-zinc-300">{payloads.length} Units Available</span>
        <button onClick={refreshPayloads} className="p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-colors border border-white/10">
          <RefreshCw className={cn("w-6 h-6", loading && "animate-spin")} />
        </button>
      </div>
    </div>
    
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {payloads.length > 0 ? payloads.map((path, idx) => (
        <PayloadCard key={path} path={path} idx={idx} loading={loading} onLoad={onLoad} onDelete={onDelete} showPath={false} showDelete={false} />
      )) : (
        <div className="col-span-full py-32 text-center glass-card border-dashed bg-white/5 rounded-ps-2xl opacity-50">
           <Database className="w-16 h-16 text-zinc-500 mx-auto mb-6" />
           <p className="text-2xl text-zinc-400 font-bold">No payloads found</p>
        </div>
      )}
    </div>
  </div>
)

const StorageHub = ({ ip, uploading, handleFileUpload, remotePayloads, payloads, onDelete, onInstall }) => {
  const [subView, setSubView] = useState('menu') // menu, repo, remove
  const isPS5 = navigator.userAgent.includes("PlayStation")
  const displayPort = window.location.port || "50005"
  const displayHost = (window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') 
    ? window.location.hostname 
    : ip
  const managementUrl = `http://${displayHost}:${displayPort}`
  const internalPayloads = payloads.filter(p => !p.includes('/mnt/usb'))

  // Helper for version matching
  const getBaseName = (filename) => filename.split('_v')[0]
  
  const localFilenames = internalPayloads.map(p => p.split('/').pop())
  
  const remoteStatus = useMemo(() => {
    return remotePayloads.map(p => {
      const isInstalled = localFilenames.includes(p.filename)
      const baseName = getBaseName(p.filename)
      const installedVersion = localFilenames.find(f => getBaseName(f) === baseName)
      const isUpdate = !isInstalled && !!installedVersion
      
      return { ...p, isInstalled, isUpdate, installedFilename: installedVersion }
    }).sort((a, b) => {
      if (a.isUpdate && !b.isUpdate) return -1
      if (!a.isUpdate && b.isUpdate) return 1
      if (a.isInstalled && !b.isInstalled) return 1
      if (!a.isInstalled && b.isInstalled) return -1
      return 0
    })
  }, [remotePayloads, localFilenames])

  if (subView === 'repo') {
    return (
      <div className="space-y-8 animate-fade-in">
        <div className="flex items-center space-x-6">
          <button onClick={() => setSubView('menu')} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter">
            Cloud <span className="text-ps-blue">Repository</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {remoteStatus.map((p, i) => (
            <div key={i} className={cn(
              "glass-card p-6 rounded-ps-2xl flex items-center justify-between border-white/10 transition-all",
              p.isInstalled && "opacity-50 grayscale bg-black/40"
            )}>
              <div className="space-y-2">
                <div className="flex items-center space-x-4">
                   <span className="font-bold text-white uppercase text-xl tracking-tight">{p.filename}</span>
                   {p.isUpdate && (
                     <span className="text-[10px] bg-emerald-500 text-white px-2 py-1 rounded font-black uppercase tracking-widest animate-pulse">Update Available</span>
                   )}
                   {p.isInstalled && (
                     <span className="text-[10px] bg-zinc-700 text-zinc-300 px-2 py-1 rounded font-black uppercase tracking-widest">Installed</span>
                   )}
                </div>
                <p className="text-md text-zinc-300 font-medium max-w-2xl">{p.description}</p>
              </div>
              
              {!p.isInstalled && (
                <button 
                  onClick={() => onInstall(p, p.installedFilename)} 
                  disabled={uploading}
                  className={cn(
                    "flex items-center space-x-3 px-6 py-4 rounded-xl font-bold transition-all shadow-xl disabled:opacity-50",
                    p.isUpdate ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-ps-blue hover:bg-ps-blue/80 text-white"
                  )}
                >
                  <CloudDownload className={cn("w-6 h-6", uploading && "animate-spin")} />
                  <span>{p.isUpdate ? "Update" : "Install"}</span>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (subView === 'remove') {
    return (
      <div className="space-y-8 animate-fade-in">
        <div className="flex items-center space-x-6">
          <button onClick={() => setSubView('menu')} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter">
            Remove <span className="text-red-500">Payload</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {internalPayloads.map((path, i) => {
            const fileName = path.split('/').pop()
            return (
              <div key={i} className="flex items-center justify-between p-6 glass-card rounded-ps-xl border-white/10 hover:bg-white/[0.02]">
                <div>
                   <p className="font-bold text-white uppercase text-xl tracking-tight">{fileName}</p>
                   <p className="text-sm font-mono text-zinc-400">{path}</p>
                </div>
                <button 
                  onClick={() => onDelete(fileName)}
                  className="p-4 rounded-xl bg-red-950/40 text-red-500 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all shadow-lg"
                >
                  <Trash2 className="w-6 h-6" />
                </button>
              </div>
            )
          })}
          {internalPayloads.length === 0 && (
            <div className="py-24 text-center opacity-40 italic text-xl text-zinc-400">No payloads found in local storage.</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-12 animate-fade-in">
      <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter">
        Payload <span className="text-ps-blue">Management</span>
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <button 
          onClick={() => setSubView('repo')}
          className="glass-card p-10 rounded-ps-2xl flex flex-col items-center justify-center space-y-4 border-white/10 hover:border-ps-blue group"
        >
          <div className="p-6 rounded-3xl bg-ps-blue/10 group-hover:bg-ps-blue group-hover:text-white transition-all">
            <CloudDownload className="w-12 h-12" />
          </div>
          <span className="text-xl font-black uppercase tracking-tighter">Get Payloads from Repository</span>
        </button>

        <button 
          onClick={() => setSubView('remove')}
          className="glass-card p-10 rounded-ps-2xl flex flex-col items-center justify-center space-y-4 border-white/10 hover:border-red-500 group"
        >
          <div className="p-6 rounded-3xl bg-red-500/10 group-hover:bg-red-500 group-hover:text-white transition-all">
            <Trash2 className="w-12 h-12" />
          </div>
          <span className="text-xl font-black uppercase tracking-tighter">Remove Payload</span>
        </button>
      </div>

      <div className="glass-card p-10 rounded-ps-2xl flex items-center space-x-12 border-white/10 bg-white/[0.02]">
        <div className="bg-white p-6 rounded-3xl shadow-2xl shrink-0">
          <QRCodeSVG value={managementUrl} size={180} level="M" />
        </div>
        <div className="flex-1 space-y-6">
          <div>
            <h4 className="label-caps mb-3 text-lg">Network Control</h4>
            <div className="px-6 py-4 bg-black/40 border border-white/10 rounded-2xl">
              <code className="text-ps-blue font-mono font-bold text-xl tracking-tight">{managementUrl}</code>
            </div>
          </div>
          <p className="text-md text-zinc-300 leading-relaxed italic font-medium">
            Scan OR view the URL in your desktop browser for easy management and file transfers.
          </p>
        </div>
      </div>
    </div>
  )
}

const AutoloadView = ({ payloads, config, onSaveConfig }) => {
  const [enabled, setEnabled] = useState(false)
  const [autoloadList, setAutoloadList] = useState([])

  useEffect(() => {
    if (config) {
      setEnabled(config.AUTOLOAD_ENABLED === true || config.AUTOLOAD_ENABLED === "true")
      setAutoloadList(config.AUTOLOAD_LIST ? config.AUTOLOAD_LIST.split(',').filter(x => x) : [])
    }
  }, [config])

  const internalPayloads = payloads.filter(p => !p.includes('/mnt/usb')).map(p => p.split('/').pop())
  const availablePayloads = internalPayloads.filter(p => !autoloadList.includes(p))

  const SPECIAL_PAYLOADS = ['etaHEN', 'kstuff', 'kstuff-lite']
  const KSTUFF_VARIANTS = ['kstuff', 'kstuff-lite']

  const overlapVariant = useMemo(() => {
    const hasEta = autoloadList.some(p => p.toLowerCase().includes('etahen'))
    if (!hasEta) return null
    return autoloadList.find(p => KSTUFF_VARIANTS.some(v => p.toLowerCase().includes(v)))
  }, [autoloadList])

  const hasOverlapWarning = !!overlapVariant

  const validateAndOrder = (newList) => {
    // 1. Remove duplicates or mutually exclusive kstuff
    const lastAdded = newList[newList.length - 1]
    if (KSTUFF_VARIANTS.some(v => lastAdded?.toLowerCase().includes(v))) {
      newList = newList.filter(p => {
        if (p === lastAdded) return true
        if (KSTUFF_VARIANTS.some(v => p.toLowerCase().includes(v))) return false
        return true
      })
    }

    // 2. Separate normal and special
    let normal = newList.filter(p => !SPECIAL_PAYLOADS.some(s => p.toLowerCase().includes(s)))
    let special = newList.filter(p => SPECIAL_PAYLOADS.some(s => p.toLowerCase().includes(s)))

    // 3. Reorder special: etaHEN before kstuff
    special.sort((a, b) => {
      const isEtaA = a.toLowerCase().includes('etahen')
      const isEtaB = b.toLowerCase().includes('etahen')
      if (isEtaA && !isEtaB) return -1
      if (!isEtaA && isEtaB) return 1
      return 0
    })

    return [...normal, ...special]
  }

  const handleAdd = (name) => {
    const newList = validateAndOrder([...autoloadList, name])
    setAutoloadList(newList)
  }

  const handleRemove = (name) => {
    setAutoloadList(autoloadList.filter(p => p !== name))
  }

  const move = (index, direction) => {
    const newList = [...autoloadList]
    const target = index + direction
    if (target < 0 || target >= newList.length) return
    
    // Check if moving would violate "special payloads at end" rule
    const p1 = newList[index]
    const p2 = newList[target]
    const isSpecial1 = SPECIAL_PAYLOADS.some(s => p1.toLowerCase().includes(s))
    const isSpecial2 = SPECIAL_PAYLOADS.some(s => p2.toLowerCase().includes(s))

    // If p1 is normal and p2 is special, p1 can't move down (target index > index)
    if (!isSpecial1 && isSpecial2 && direction > 0) return
    // If p1 is special and p2 is normal, p1 can't move up (target index < index)
    if (isSpecial1 && !isSpecial2 && direction < 0) return

    // Reorder within special/normal group
    [newList[index], newList[target]] = [newList[target], newList[index]]
    
    // Final check for etaHEN before kstuff
    const finalOrdered = validateAndOrder(newList)
    setAutoloadList(finalOrdered)
  }

  const save = () => {
    onSaveConfig({
      AUTOLOAD_ENABLED: enabled,
      AUTOLOAD_LIST: autoloadList.join(',')
    })
  }

  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-8 animate-fade-in">
        <div className="p-10 rounded-full bg-ps-blue/10 border border-ps-blue/20">
          <Zap className="w-20 h-20 text-ps-blue" />
        </div>
        <div className="text-center space-y-4 max-w-xl">
           <h2 className="text-4xl font-black uppercase italic tracking-tighter">Payload <span className="text-ps-blue">Autoload</span></h2>
           <p className="text-lg text-zinc-400 font-medium">
             Automatically execute a sequence of payloads every time the Next Menu is loaded. 
             Perfect for setting up your environment without manual interaction.
             <br /><br />
             <strong>Note:</strong> You will have a chance to abort the sequence before it starts.
           </p>
        </div>
        <button 
          onClick={() => { setEnabled(true); }}
          className="px-12 py-5 bg-ps-blue hover:bg-ps-blue/80 text-white rounded-2xl font-black text-xl shadow-2xl transition-all"
        >
          Enable Autoload
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-5xl font-black text-white uppercase italic tracking-tighter">
          Autoload <span className="text-ps-blue">Management</span>
        </h2>
        <div className="flex items-center space-x-4">
          <button 
            onClick={() => { setEnabled(false); setAutoloadList([]); }}
            className="px-6 py-3 bg-red-950/30 text-red-500 font-bold rounded-xl border border-red-500/20 hover:bg-red-500 hover:text-white transition-all"
          >
            Disable
          </button>
          <button 
            onClick={save}
            className="px-10 py-3 bg-ps-blue hover:bg-ps-blue/80 text-white font-bold rounded-xl shadow-lg transition-all"
          >
            Save Config
          </button>
        </div>
      </div>

      {hasOverlapWarning && (
        <div className="p-6 bg-amber-950/40 border border-amber-500/40 rounded-2xl flex items-start space-x-6 animate-pulse">
           <AlertTriangle className="w-10 h-10 text-amber-500 shrink-0" />
           <div className="space-y-1">
              <h4 className="text-xl font-bold text-amber-500 uppercase">Redundant Payloads Detected</h4>
              <p className="text-zinc-200">
                You have both <strong>etaHEN</strong> and <strong>{overlapVariant}</strong> in your autoload list. 
                etaHEN usually includes kstuff features by default. Consider disabling kstuff in etaHEN settings or removing it from this list.
              </p>
           </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-10">
        <div className="space-y-6">
           <h3 className="label-caps !text-[14px]">Available Payloads</h3>
           <div className="glass-card rounded-ps-xl border-white/10 min-h-[400px] p-4 space-y-3 bg-black/20">
              {availablePayloads.map((name, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5 hover:border-ps-blue group">
                   <span className="font-bold text-lg truncate">{name}</span>
                   <button 
                     onClick={() => handleAdd(name)}
                     className="p-2 bg-ps-blue/20 text-ps-blue rounded-lg group-hover:bg-ps-blue group-hover:text-white transition-all"
                   >
                     <ArrowRight className="w-5 h-5" />
                   </button>
                </div>
              ))}
              {availablePayloads.length === 0 && (
                <p className="text-center py-20 text-zinc-500 italic">No more payloads available.</p>
              )}
           </div>
        </div>

        <div className="space-y-6">
           <h3 className="label-caps !text-[14px]">Autoload Sequence</h3>
           <div className="glass-card rounded-ps-xl border-white/10 min-h-[400px] p-4 space-y-3 bg-ps-blue/5">
              {autoloadList.map((name, i) => {
                const isSpecial = SPECIAL_PAYLOADS.some(s => name.toLowerCase().includes(s))
                return (
                  <div key={i} className={cn(
                    "flex items-center space-x-4 p-4 rounded-xl border transition-all",
                    isSpecial ? "bg-ps-blue/20 border-ps-blue/40 shadow-[0_0_15px_rgba(0,149,255,0.1)]" : "bg-white/10 border-white/10"
                  )}>
                    <div className="flex flex-col space-y-1">
                       <button onClick={() => move(i, -1)} className="p-1 hover:text-ps-blue disabled:opacity-20" disabled={i === 0}>
                         <ChevronUp className="w-5 h-5" />
                       </button>
                       <button onClick={() => move(i, 1)} className="p-1 hover:text-ps-blue disabled:opacity-20" disabled={i === autoloadList.length - 1}>
                         <ChevronDown className="w-5 h-5" />
                       </button>
                    </div>
                    <span className={cn("flex-1 font-bold text-lg truncate", isSpecial && "text-ps-blue")}>
                      {name}
                      {isSpecial && <span className="ml-3 text-[10px] bg-ps-blue text-white px-2 py-0.5 rounded-full font-black uppercase">Core</span>}
                    </span>
                    <button 
                      onClick={() => handleRemove(name)}
                      className="p-2 text-zinc-500 hover:text-red-500 transition-all"
                    >
                      <Trash2 className="w-6 h-6" />
                    </button>
                  </div>
                )
              })}
              {autoloadList.length === 0 && (
                <p className="text-center py-20 text-zinc-500 italic">Autoload list is empty.</p>
              )}
           </div>
        </div>
      </div>
    </div>
  )
}

const TerminalView = ({ logs, setLogs, logEndRef }) => (
  <div className="flex flex-col h-full space-y-6 animate-fade-in">
    <div className="flex items-center justify-between px-2">
      <div className="flex items-center space-x-4">
        <Terminal className="w-8 h-8 text-ps-blue" />
        <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter">Logs</h2>
      </div>
      <button 
        onClick={() => setLogs([])} 
        className="px-6 py-2 bg-red-950/30 text-red-500 text-sm font-bold rounded-xl border border-red-500/20 hover:bg-red-500 hover:text-white transition-all shadow-lg"
      >
        Clear Memory
      </button>
    </div>

    <div className="flex-1 flex flex-col bg-[#050505] border border-white/10 rounded-ps-xl overflow-hidden shadow-2xl">
      <div className="flex-1 overflow-y-auto p-6 font-mono text-lg leading-relaxed custom-scrollbar selection:bg-ps-blue selection:text-white">
        {logs.length > 0 ? logs.map((log, i) => (
          <div key={i} className="flex py-1.5 hover:bg-white/5 transition-colors group">
            <span className="text-zinc-700 mr-8 select-none shrink-0 w-12 text-right opacity-50 group-hover:opacity-100 italic">{(i+1).toString().padStart(3, '0')}</span>
            <span className="text-zinc-200 group-hover:text-white transition-colors">{log}</span>
          </div>
        )) : (
          <div className="h-full flex flex-col items-center justify-center space-y-6 opacity-10">
            <Terminal className="w-32 h-32" />
            <span className="text-5xl font-black uppercase tracking-[0.5em]">No Data</span>
          </div>
        )}
        <div ref={logEndRef} />
      </div>
      <div className="px-6 py-3 bg-white/[0.03] border-t border-white/10 flex items-center justify-between">
         <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-3">
               <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
               <span className="text-[12px] uppercase font-bold text-zinc-400 tracking-widest">Active Link</span>
            </div>
            <div className="h-4 w-px bg-white/20" />
            <span className="text-[12px] font-mono text-zinc-500 italic">Native Mode</span>
         </div>
         <span className="text-[12px] font-bold text-zinc-500 uppercase tracking-tighter">{logs.length} Lines Buffered</span>
      </div>
    </div>
  </div>
)

const InfoView = ({ version }) => (
  <div className="flex flex-col items-center justify-center min-h-[70vh] text-center space-y-12 animate-fade-in px-8">
     <div className="relative">
        <div className="relative p-12 rounded-[3.5rem] bg-zinc-900 border border-white/20 text-ps-blue shadow-2xl">
           <ShieldCheck className="w-24 h-24" />
        </div>
     </div>
     <div className="space-y-6 max-w-2xl">
       <h3 className="text-6xl font-black text-white uppercase italic tracking-tighter leading-tight">Next <span className="text-ps-blue">Menu</span></h3>
       <div className="h-1 w-32 bg-ps-blue mx-auto rounded-full" />
       <p className="text-xl text-zinc-300 leading-relaxed font-medium italic">
         Unified payload deployment system for modern PlayStation 5 environments. 
         Optimized for performance and reliability.
       </p>
     </div>
     <div className="grid grid-cols-2 gap-6 w-full max-w-xl">
        {[
          { label: 'Version', val: version },
          { label: 'Platform', val: 'PS5/WebKit' },
          { label: 'Mode', val: 'Optimized' },
          { label: 'Environment', val: 'Unified' },
        ].map((item, i) => (
          <div key={i} className="p-6 bg-white/5 border border-white/10 rounded-3xl shadow-xl">
             <p className="label-caps !text-[11px] mb-2">{item.label}</p>
             <p className="text-2xl font-black text-white tracking-tight">{item.val}</p>
          </div>
        ))}
     </div>
  </div>
)

function App() {
  const [view, setView] = useState('dashboard') // dashboard, payloads, manage, autoload, logs, settings
  const [logs, setLogs] = useState([])
  const [payloads, setPayloads] = useState([])
  const [remotePayloads, setRemotePayloads] = useState([])
  const [config, setConfig] = useState({})
  const [ip, setIp] = useState('0.0.0.0')
  const [version, setVersion] = useState('Loading...')
  const [loading, setLoading] = useState(false)
  const [activeLoadingName, setActiveLoadingName] = useState('')
  const [uploading, setUploading] = useState(false)
  const logEndRef = useRef(null)

  // Use Gamepad Navigation
  useGamepadNavigation(view, setView)

  // API Call helper
  const api = async (endpoint, options = {}) => {
    try {
      const response = await fetch(endpoint, options)
      if (options.method === 'POST') return response.text()
      try {
        const text = await response.text()
        // Prevent parsing HTML as JSON (Vite dev server fallback)
        if (text.trim().startsWith('<!DOCTYPE')) return null
        return JSON.parse(text)
      } catch (e) {
        return null 
      }
    } catch (e) {
      console.error(`API Error (${endpoint}):`, e)
      return null
    }
  }

  const refreshPayloads = async () => {
    const data = await api('/list_payloads')
    if (data?.payloads) setPayloads(data.payloads)
  }

  const refreshConfig = async () => {
    const data = await api('/get_config')
    if (data) setConfig(data)
  }

  useEffect(() => {
    const init = async () => {
      const ipData = await fetch('/getip').then(r => r.text()).catch(() => '0.0.0.0')
      setIp(ipData.includes('<!DOCTYPE') ? '192.168.1.133' : ipData)
      
      const verData = await fetch('/version').then(r => r.text()).catch(() => '?')
      setVersion(verData.includes('<!DOCTYPE') ? '1.0.0-dev' : verData)

      refreshPayloads()
      refreshConfig()

      // Fetch remote payloads
      try {
        const res = await fetch(PAYLOAD_EXPLORER_URL)
        const data = await res.json()
        if (Array.isArray(data)) setRemotePayloads(data)
      } catch (e) { console.error("Remote fetch fail", e) }
    }
    init()

    const logInterval = setInterval(async () => {
      const logData = await api('/log')
      if (logData?.logs) setLogs(logData.logs)
    }, 1500)

    const kaInterval = setInterval(() => fetch('/keepalive').catch(() => {}), 2000)

    return () => { clearInterval(logInterval); clearInterval(kaInterval); }
  }, [])

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'auto' }) }, [logs])

  const loadPayload = async (path) => {
    const name = path.split('/').pop().replace(/\.(elf|bin|lua)$/i, '').replace(/_/g, ' ')
    setLoading(true)
    setActiveLoadingName(name)
    await fetch(`/loadpayload:${encodeURIComponent(path)}`).catch(() => {})
    setLoading(false)
  }

  const deletePayload = async (fileName, silent = false) => {
    if (!silent && !confirm(`Are you sure you want to delete ${fileName}?`)) return
    await fetch(`/manage:delete?filename=${encodeURIComponent(fileName)}`).catch(() => {})
    refreshPayloads()
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      await fetch(`/manage:upload?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file
      })
      refreshPayloads()
    } catch (e) { 
      console.error("Upload failed", e)
      alert("Upload failed") 
    }
    setUploading(false)
  }

  const handleRemoteInstall = async (p, oldFilename = null) => {
    setUploading(true)
    try {
      const resp = await fetch(p.url)
      if (!resp.ok) throw new Error("Fetch failed")
      const blob = await resp.blob()
      
      // Upload new
      const uploadResp = await fetch(`/manage:upload?filename=${encodeURIComponent(p.filename)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob
      })
      
      if (uploadResp.ok && oldFilename) {
        // Delete old if new succeeded
        await deletePayload(oldFilename, true)
      }
      
      refreshPayloads()
    } catch (e) { 
      console.error("Install failed", e)
      alert("Failed to fetch/install from cloud") 
    }
    setUploading(false)
  }

  const handleSaveConfig = async (newConfig) => {
    const merged = { ...config, ...newConfig }
    const success = await api('/set_config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merged)
    })
    if (success) {
      alert("Configuration saved successfully")
      refreshConfig()
    } else {
      alert("Failed to save configuration")
    }
  }

  return (
    <div className="h-screen w-screen overflow-hidden select-none relative bg-ps-black text-white flex">
      {/* Sidebar Navigation */}
      <nav className="w-24 glass-panel flex flex-col items-center py-10 space-y-10 z-50">
        <SidebarItem id="dashboard" label="Home" icon={LayoutDashboard} isActive={view === 'dashboard'} onClick={setView} />
        <SidebarItem id="payloads" label="Launch" icon={Play} isActive={view === 'payloads'} onClick={setView} />
        <SidebarItem id="manage" label="Files" icon={Database} isActive={view === 'manage'} onClick={setView} />
        <SidebarItem id="autoload" label="Auto" icon={Zap} isActive={view === 'autoload'} onClick={setView} />
        <SidebarItem id="logs" label="Logs" icon={Terminal} isActive={view === 'logs'} onClick={setView} />
        <SidebarItem id="settings" label="Info" icon={Info} isActive={view === 'settings'} onClick={setView} />

        <div className="mt-auto pt-8 border-t border-white/10 flex flex-col items-center space-y-8">
           <button 
             onClick={() => fetch('/shutdown')} 
             className="w-16 h-16 rounded-2xl text-zinc-500 hover:text-red-500 hover:bg-red-500/10 transition-all flex items-center justify-center group relative focus:bg-red-500/20"
           >
              <Power className="w-8 h-8" />
              <span className="absolute left-full ml-6 px-3 py-1.5 bg-zinc-900 text-red-500 text-[12px] font-bold rounded-lg opacity-0 group-hover:opacity-100 group-focus:opacity-100 pointer-events-none uppercase tracking-widest shadow-2xl">Exit</span>
           </button>
        </div>
      </nav>

      {/* Main Content Space */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#0a0a0c]">
        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-12 custom-scrollbar relative">
          {view === 'dashboard' && (
            <Dashboard 
              ip={ip} 
              version={version} 
              logs={logs} 
              payloads={payloads} 
              setView={setView} 
              loading={loading}
              onLoad={loadPayload}
              onDelete={deletePayload}
            />
          )}
          {view === 'payloads' && (
            <ExecutionList 
              payloads={payloads} 
              loading={loading} 
              refreshPayloads={refreshPayloads} 
              onLoad={loadPayload}
              onDelete={deletePayload}
            />
          )}
          {view === 'manage' && (
            <StorageHub 
              ip={ip} 
              uploading={uploading} 
              handleFileUpload={handleFileUpload} 
              remotePayloads={remotePayloads} 
              payloads={payloads}
              onDelete={deletePayload}
              onInstall={handleRemoteInstall}
            />
          )}
          {view === 'autoload' && (
            <AutoloadView 
              payloads={payloads}
              config={config}
              onSaveConfig={handleSaveConfig}
            />
          )}
          {view === 'logs' && (
            <TerminalView 
              logs={logs} 
              setLogs={setLogs} 
              logEndRef={logEndRef} 
            />
          )}
          {view === 'settings' && (
            <InfoView 
              version={version} 
            />
          )}
        </div>
      </main>

      {/* Overlay Loading State */}
      {loading && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-lg z-[100] flex flex-col items-center justify-center space-y-8 animate-fade-in">
           <div className="relative">
              <div className="w-32 h-32 border-8 border-ps-blue/10 rounded-full" />
              <div className="absolute inset-0 w-32 h-32 border-8 border-ps-blue rounded-full border-t-transparent animate-spin shadow-[0_0_50px_rgba(0,149,255,0.5)]" />
           </div>
           <div className="text-center">
              <h4 className="text-4xl font-black italic text-white uppercase tracking-tighter mb-3">{activeLoadingName || "Engaging Core"}</h4>
              <p className="label-caps !text-[16px] animate-pulse text-ps-blue">LAUNCHING PAYLOAD. PLEASE WAIT...</p>
           </div>
        </div>
      )}
    </div>
  )
}

export default App
