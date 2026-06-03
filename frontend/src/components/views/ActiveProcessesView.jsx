import React, { useState, useEffect, useMemo } from 'react'
import { Cpu, RefreshCw, XCircle, Search, AlertCircle, Activity, Loader2 } from 'lucide-react'
import { cn, isPS5 } from '../../utils/helpers'

const ActiveProcessesView = ({ ip, addToast, showConfirm }) => {
  const [processes, setProcesses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [search, setSearch] = useState('')

  const fetchProcesses = async (isBackground = false) => {
    if (!isBackground) setLoading(true)
    if (!isBackground) setError(false)
    try {
      const res = await fetch('/processes_list')
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (data && data.processes) {
        setProcesses(data.processes)
      } else {
        setProcesses([])
      }
    } catch {
      if (!isBackground) setError(true)
    } finally {
      if (!isBackground) setLoading(false)
    }
  }

  useEffect(() => {
    fetchProcesses()
    
    const intervalId = setInterval(() => {
      fetchProcesses(true)
    }, 15000)

    return () => clearInterval(intervalId)
  }, [])

  const filteredProcesses = useMemo(() => {
    let result = processes
    if (!showAll) {
      result = result.filter(p => p.is_daemon)
    }
    if (search.trim() !== '') {
      const q = search.toLowerCase()
      result = result.filter(p => p.name.toLowerCase().includes(q))
    }
    return result
  }, [processes, showAll, search])

  const handleKill = (p) => {
    if (p.name === 'pldmgr.elf' || p.name === 'elfldr.elf') {
      addToast(`Cannot kill ${p.name}`, "error")
      return
    }

    showConfirm(
      "Kill Process",
      `Are you sure you want to kill ${p.name} (PID: ${p.pid})?`,
      async () => {
        try {
          const res = await fetch(`/process_kill?pid=${p.pid}`)
          if (res.ok) {
            addToast(`Successfully killed ${p.name}`)
            setTimeout(() => {
              fetchProcesses(true)
            }, 500)
          } else {
            addToast(`Failed to kill ${p.name}`, "error")
          }
        } catch (e) {
          addToast(`Error killing ${p.name}`, "error")
        }
      }
    )
  }

  return (
    <div className="space-y-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
        <h2 className="text-4xl font-extrabold text-white tracking-tight">
          Active <span className="text-ps-blue">Processes</span>
        </h2>
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <span className="text-zinc-400 font-bold tracking-tight group-hover:text-white transition-colors">Show All System Processes</span>
            <div className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ps-blue focus:ring-offset-2 focus:ring-offset-black bg-white/10 group-hover:bg-white/20">
              <input
                type="checkbox"
                className="sr-only"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                  showAll ? "translate-x-6 bg-ps-blue" : "translate-x-1"
                )}
              />
            </div>
          </label>
        </div>
      </div>

      <section className="space-y-6">
        {/* Search bar */}
        <div className="flex items-center bg-black/40 border border-white/10 rounded-2xl px-4 py-3 focus-within:border-ps-blue/50 transition-colors">
          <Search className="w-5 h-5 text-zinc-500 mr-3" />
          <input
            type="text"
            placeholder="Search processes by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none text-white w-full font-medium placeholder:text-zinc-600"
          />
        </div>

        {loading && processes.length === 0 ? (
          <div className="py-24 glass-panel rounded-ps-3xl border-white/5 flex flex-col items-center justify-center space-y-6">
            <Loader2 className="w-16 h-16 text-ps-blue animate-spin" />
            <p className="label-caps">Fetching process list...</p>
          </div>
        ) : error ? (
          <div className="py-20 glass-card rounded-ps-3xl border-red-500/20 flex flex-col items-center justify-center space-y-6 bg-red-950/5">
            <AlertCircle className="w-16 h-16 text-red-500 opacity-50" />
            <div className="text-center">
              <p className="text-xl font-bold text-white uppercase tracking-tight">Failed to load processes</p>
            </div>
            <button onClick={() => fetchProcesses()} className="px-8 py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-xl font-bold uppercase text-xs transition-all">Retry</button>
          </div>
        ) : filteredProcesses.length === 0 ? (
          <div className="py-20 border-2 border-dashed border-white/5 rounded-ps-3xl flex flex-col items-center justify-center space-y-4 bg-white/[0.01]">
            <Activity className="w-16 h-16 text-white/5" />
            <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm italic">No processes found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredProcesses.map((p) => (
              <div key={p.pid} className={cn(
                "glass-card p-4 md:p-6 rounded-2xl flex flex-row items-center justify-between gap-4 border-white/10 hover:border-ps-blue/20 transition-all bg-white/[0.01]"
              )}>
                <div className="flex items-center space-x-4 min-w-0 flex-1">
                  <div className={cn(
                    "p-3 rounded-xl flex-shrink-0",
                    p.is_daemon ? "bg-ps-blue/10 text-ps-blue" : "bg-white/5 text-zinc-400"
                  )}>
                    <Cpu className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <h3 className="text-xl font-bold text-white truncate">{p.name}</h3>
                    <div className="flex items-center space-x-4 text-xs font-mono text-zinc-500 uppercase tracking-wider">
                      <span>PID: <span className="text-zinc-300">{p.pid}</span></span>
                      <span>MEM: <span className="text-zinc-300">{p.memory.toFixed(1)} MiB</span></span>
                    </div>
                  </div>
                </div>
                {p.is_daemon && p.name !== 'pldmgr.elf' && p.name !== 'elfldr.elf' && (
                  <button
                    onClick={() => handleKill(p)}
                    className="p-3 md:px-6 md:py-3 rounded-xl bg-red-950/20 text-red-500 border border-red-500/10 hover:bg-red-500 hover:text-white transition-all flex items-center justify-center space-x-2 shrink-0 group"
                    title="Kill Process"
                  >
                    <XCircle className="w-5 h-5 group-hover:scale-110 transition-transform" />
                    <span className="hidden md:inline font-bold uppercase tracking-tight text-sm">Kill</span>
                  </button>
                )}
                {(p.name === 'pldmgr.elf' || p.name === 'elfldr.elf') && (
                  <div className="p-3 md:px-6 md:py-3 rounded-xl bg-white/5 text-zinc-500 border border-white/5 flex items-center justify-center space-x-2 shrink-0 opacity-50 cursor-not-allowed" title="Cannot kill critical process">
                    <XCircle className="w-5 h-5" />
                    <span className="hidden md:inline font-bold uppercase tracking-tight text-sm">Kill</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default ActiveProcessesView
