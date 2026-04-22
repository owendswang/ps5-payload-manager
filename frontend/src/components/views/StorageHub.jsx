import React, { useState, useEffect, useMemo } from 'react'
import { CloudDownload, Upload, Package, Database, RefreshCw, Trash2, ShieldCheck, Loader2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { cn, isPS5 } from '../../utils/helpers'
import PayloadName from '../ui/PayloadName'

const StorageHub = ({ payloads, onInstall, onDelete, onUpload, ip }) => {
  const [remotePayloads, setRemotePayloads] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(0)

  const PAYLOAD_REPO_URL = 'https://itsplk.github.io/ps5_payloads/ps5_payloads.json'

  const fetchRemote = async (force = false) => {
    setLoading(true)
    setError(false)
    try {
      let data

      if (force) {
        // Browser fetches JSON over HTTPS (no TLS issues in the browser),
        // then POSTs it to the daemon which stores it as the local cache.
        const ghRes = await fetch(PAYLOAD_REPO_URL)
        if (!ghRes.ok) throw new Error('GitHub fetch failed')
        const rawJson = await ghRes.text()

        const pushRes = await fetch('/repository_push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: rawJson,
        })
        if (!pushRes.ok) throw new Error('Push to daemon failed')
        data = await pushRes.json()
      } else {
        // Normal load: read from the daemon's local cache
        const res = await fetch('/repository_payloads')
        if (!res.ok) throw new Error()
        data = await res.json()
      }

      if (!Array.isArray(data?.payloads)) throw new Error()
      setRemotePayloads(data.payloads)
      setLastUpdate(Number(data.last_update || 0))
    } catch (e) {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRemote()
  }, [])

  const localFilenames = useMemo(() => payloads.map(p => p.split('/').pop()), [payloads])
  const internalPayloads = payloads.filter(p => !p.includes('/mnt/usb'))

  const getBaseName = (filename) => {
    if (!filename) return '';
    const clean = filename.replace(/\.(elf|bin|lua)$/i, '');
    const versionMatch = clean.match(/[_-](v?\d+[\d.a-z-]+)/i);
    return versionMatch ? clean.replace(versionMatch[0], '') : clean;
  }

  const remoteStatus = useMemo(() => {
    if (!Array.isArray(remotePayloads)) return []
    return remotePayloads.map(p => {
      const isInstalled = p.filename ? localFilenames.includes(p.filename) : false
      const baseName = getBaseName(p.filename)
      const installedVersion = localFilenames.find(f => getBaseName(f) === baseName)
      const isUpdate = !isInstalled && !!installedVersion

      return { ...p, isInstalled, isUpdate, installedFilename: installedVersion }
    }).sort((a, b) => {
      if (a.isUpdate && !b.isUpdate) return -1
      if (!a.isUpdate && b.isUpdate) return 1
      return 0
    })
  }, [remotePayloads, localFilenames])

  const cloudItems = remoteStatus.filter(p => !p.isInstalled || p.isUpdate);

  return (
    <div className="space-y-12 animate-fade-in pb-32">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
        <h2 className="text-5xl font-extrabold text-white tracking-tight">
          Payload <span className="text-ps-blue">Management</span>
        </h2>

        {!isPS5 && (
          <label className="inline-flex items-center space-x-4 px-10 py-5 bg-ps-blue hover:bg-ps-blue/80 text-white rounded-[1.25rem] font-bold tracking-tight text-xl cursor-pointer transition-all shadow-2xl shadow-ps-blue/20 shrink-0 transform active:scale-95">
            <Upload className="w-7 h-7" />
            <span>Upload ELF Payload</span>
            <input type="file" className="hidden" onChange={onUpload} accept=".elf,.bin,.lua" />
          </label>
        )}
      </div>

      {/* Installed Payloads Section */}
      <section className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <h3 className="label-caps !text-white flex items-center space-x-4 text-lg">
            <Database className="w-6 h-6 text-ps-blue" />
            <span>Installed Payloads</span>
          </h3>
          <span className="bg-white/5 px-4 py-1 rounded-full text-zinc-500 font-bold text-xs">
            {internalPayloads.length} Files
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {internalPayloads.length === 0 ? (
            <div className="py-20 border-2 border-dashed border-white/5 rounded-ps-3xl flex flex-col items-center justify-center space-y-4 bg-white/[0.01]">
              <Package className="w-16 h-16 text-white/5" />
              <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm italic">Library Empty</p>
            </div>
          ) : (
            internalPayloads.map((path, i) => {
              const fileName = path.split('/').pop()
              const remoteMatch = remoteStatus.find(rp => rp.filename === fileName || rp.installedFilename === fileName)
              return (
                <div key={i} className="group flex items-center justify-between p-6 glass-card rounded-ps-2xl border-white/10 hover:border-ps-blue/30">
                  <div className="flex items-center space-x-6">
                    <div className="p-4 bg-white/5 rounded-2xl group-hover:bg-ps-blue/10 transition-colors">
                      <Package className="w-8 h-8 text-zinc-400 group-hover:text-ps-blue transition-colors" />
                    </div>
                    <div>
                      <PayloadName path={fileName} className="text-2xl" versionClassName="text-sm px-3 py-1 bg-ps-blue/10 text-ps-blue border-ps-blue/20" />
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    {remoteMatch?.isUpdate && (
                      <button
                        onClick={() => onInstall(remoteMatch)}
                        className="flex items-center space-x-3 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm transition-all shadow-xl shadow-emerald-900/20"
                      >
                        <RefreshCw className="w-5 h-5 animate-spin-slow" />
                        <span>Update Available</span>
                      </button>
                    )}
                    <button
                      onClick={() => onDelete(fileName)}
                      className="p-4 rounded-xl bg-red-950/20 text-red-500 border border-red-500/10 hover:bg-red-500 hover:text-white transition-all shadow-xl"
                      title="Remove Payload"
                    >
                      <Trash2 className="w-6 h-6" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* Cloud Repository Section */}
      <section className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <h3 className="label-caps !text-white flex items-center space-x-4 text-lg" >
            <CloudDownload className="w-6 h-6 text-ps-blue" />
            <span>Cloud Repository</span>
          </h3>
          <button onClick={() => fetchRemote(true)} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-zinc-500 hover:text-ps-blue">
            <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
          </button>
        </div>
        {lastUpdate > 0 && (
          <p className="px-2 text-xs uppercase tracking-widest text-zinc-500">
            Last Sync: {new Date(lastUpdate * 1000).toLocaleString()}
          </p>
        )}

        {loading && remotePayloads.length === 0 ? (
          <div className="py-24 glass-panel rounded-ps-3xl border-white/5 flex flex-col items-center justify-center space-y-6">
            <Loader2 className="w-16 h-16 text-ps-blue animate-spin" />
            <p className="label-caps animate-pulse">Syncing with Repository...</p>
          </div>
        ) : error ? (
          <div className="py-20 glass-card rounded-ps-3xl border-red-500/20 flex flex-col items-center justify-center space-y-6 bg-red-950/5">
            <AlertTriangle className="w-16 h-16 text-red-500 opacity-50" />
            <div className="text-center">
              <p className="text-xl font-bold text-white uppercase tracking-tight">Repository Unavailable</p>
              <p className="text-zinc-500 mt-1">Check your internet connection and try again.</p>
            </div>
            <button onClick={() => fetchRemote(true)} className="px-8 py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-xl font-bold uppercase text-xs transition-all">Retry Connection</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {cloudItems.length === 0 ? (
              <div className="py-20 border-2 border-dashed border-white/5 rounded-ps-3xl flex flex-col items-center justify-center space-y-4 bg-white/[0.01]">
                <ShieldCheck className="w-16 h-16 text-emerald-500/10" />
                <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm italic">Repository Up to Date</p>
              </div>
            ) : (
              cloudItems.map((p, i) => (
                <div key={i} className={cn(
                  "glass-card p-8 rounded-ps-3xl flex justify-between gap-8 border-white/10 hover:border-ps-blue/20 transition-all bg-white/[0.01]",
                  isPS5 ? "flex-row items-center" : "flex-col md:flex-row md:items-center"
                )}>
                  <div className="space-y-3">
                    <div className="flex items-center space-x-4">
                      <PayloadName path={p.filename} className="text-2xl" versionClassName="text-sm px-3 py-1 bg-ps-blue/10 text-ps-blue border-ps-blue/20" />
                    </div>
                    <p className="text-lg text-zinc-400 font-medium max-w-3xl leading-relaxed">{p.description}</p>
                  </div>

                  <button
                    onClick={() => onInstall(p)}
                    className={cn(
                      "flex items-center justify-center space-x-4 px-8 py-5 rounded-2xl font-bold text-xl transition-all shadow-2xl shrink-0 transform active:scale-95",
                      p.isUpdate ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20" : "bg-ps-blue hover:bg-ps-blue/80 text-white shadow-ps-blue/20"
                    )}
                  >
                    <CloudDownload className="w-7 h-7" />
                    <span>{p.isUpdate ? "Update" : "Install"}</span>
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* Footer Info for PS5 */}
      {isPS5 && (
        <div className="glass-card p-10 rounded-ps-3xl flex items-center space-x-12 border-white/10 bg-black/40 mt-16">
          <div className="flex flex-col items-center space-y-6 shrink-0">
            <div className="bg-white p-6 rounded-3xl shadow-[0_0_50px_rgba(255,255,255,0.1)]">
              <QRCodeSVG value={`http://${ip}:8084`} size={160} level="M" />
            </div>
            <code className="text-white font-mono text-lg font-black opacity-90 italic tracking-tight uppercase">{ip}:8084</code>
          </div>
          <div className="flex-1 space-y-4">
            <h4 className="label-caps !text-white !opacity-100 text-2xl tracking-widest flex items-center space-x-4">
              <div className="w-2 h-8 bg-ps-blue rounded-full" />
              <span>Remote Management</span>
            </h4>
            <p className="text-xl text-zinc-400 leading-relaxed italic font-medium max-w-3xl">
              Access this dashboard from your computer or phone to manage and upload payloads directly from your local network.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default StorageHub
