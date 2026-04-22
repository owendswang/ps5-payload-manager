import React, { useState, useEffect } from 'react'
import { Zap, Terminal, X } from 'lucide-react'
import { cn } from '../../utils/helpers'
import LogViewer from './LogViewer'

const SettingsView = ({ config, onSaveConfig, isPS5, logs, setLogs }) => {
  const [showLogs, setShowLogs] = useState(false)

  const autoOpen = config.AUTO_BROWSER_OPEN !== false
  const autoloadDelay = config.AUTOLOAD_DELAY || 5

  useEffect(() => {
    if (!showLogs) return
    const eventSource = new EventSource('/events')
    eventSource.onmessage = (e) => {
      setLogs(prev => [...prev, e.data].slice(-100))
    }
    return () => eventSource.close()
  }, [showLogs])

  return (
    <div className="space-y-12 animate-fade-in pb-32">
      <h2 className="text-4xl font-extrabold text-white tracking-tight">
        System <span className="text-ps-blue">Settings</span>
      </h2>

      <div className={cn(
        "grid gap-8",
        isPS5 ? "grid-cols-2" : "grid-cols-1 md:grid-cols-2"
      )}>
        {/* Startup Settings */}
        <div className="glass-card p-10 rounded-ps-2xl space-y-8 border-white/10 flex flex-col">
          <h3 className="label-caps !text-white !opacity-100 flex items-center space-x-3">
            <Zap className="w-6 h-6 text-ps-blue" />
            <span>Startup & Automation</span>
          </h3>

          <div className="space-y-8 flex-1">
            <div className="flex items-center justify-between p-6 bg-white/5 rounded-2xl border border-white/10">
              <div className="space-y-1">
                <p className="font-bold text-white uppercase text-sm tracking-tight">Auto-open Browser</p>
                <p className="text-xs text-zinc-500 max-w-[200px]">Launch browser to this menu on startup.</p>
              </div>
              <button
                onClick={() => onSaveConfig({ AUTO_BROWSER_OPEN: !autoOpen })}
                className={cn(
                  "w-16 h-8 rounded-full transition-all relative overflow-hidden p-1",
                  autoOpen ? "bg-ps-blue" : "bg-white/10"
                )}
              >
                <div className={cn(
                  "w-6 h-6 bg-white rounded-full transition-all shadow-lg",
                  autoOpen ? "translate-x-8" : "translate-x-0"
                )} />
              </button>
            </div>

            <div className="flex items-center justify-between p-6 bg-white/5 rounded-2xl border border-white/10">
              <div className="space-y-1">
                <p className="font-bold text-white uppercase text-sm tracking-tight">Kill Disc Player</p>
                <p className="text-xs text-zinc-500 max-w-[200px]">Terminate Disc Player app on startup.</p>
              </div>
              <button
                onClick={() => onSaveConfig({ KILL_DISC_PLAYER_ON_STARTUP: !config.KILL_DISC_PLAYER_ON_STARTUP })}
                className={cn(
                  "w-16 h-8 rounded-full transition-all relative overflow-hidden p-1",
                  config.KILL_DISC_PLAYER_ON_STARTUP !== false ? "bg-ps-blue" : "bg-white/10"
                )}
              >
                <div className={cn(
                  "w-6 h-6 bg-white rounded-full transition-all shadow-lg",
                  config.KILL_DISC_PLAYER_ON_STARTUP !== false ? "translate-x-8" : "translate-x-0"
                )} />
              </button>
            </div>

            <div className="space-y-6 p-6 bg-white/5 rounded-2xl border border-white/10 transition-all">
              <div className="flex justify-between items-center">
                <div className="space-y-1">
                  <p className="font-bold text-white uppercase text-sm tracking-tight">Autoload Delay</p>
                  <p className="text-xs text-zinc-500">Wait time before sequence starts.</p>
                </div>
                <span className="text-ps-blue font-black text-2xl">{autoloadDelay}s</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[3, 5, 10].map(s => (
                  <button
                    key={s}
                    onClick={() => onSaveConfig({ AUTOLOAD_DELAY: s })}
                    className={cn(
                      "py-3 rounded-xl font-bold transition-all border",
                      autoloadDelay === s
                        ? "bg-ps-blue border-ps-blue text-white shadow-lg shadow-ps-blue/20"
                        : "bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10"
                    )}
                  >
                    {s}s
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Diagnostic Tools */}
        <div className="glass-card p-10 rounded-ps-2xl space-y-8 border-white/10 flex flex-col">
          <h3 className="label-caps !text-white !opacity-100 flex items-center space-x-3">
            <Terminal className="w-6 h-6 text-ps-blue" />
            <span>Diagnostics</span>
          </h3>

          <div className="flex-1 space-y-6">
            <p className="text-zinc-500 text-sm font-medium leading-relaxed">
              View real-time output from the Next Menu background service for debugging.
            </p>

            <button
              onClick={() => setShowLogs(true)}
              className="w-full py-6 rounded-2xl font-black uppercase italic tracking-tighter text-xl transition-all shadow-xl bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white border border-white/10"
            >
              Log Viewer
            </button>
          </div>
        </div>
      </div>

      {showLogs && (
        <div className="fixed inset-0 z-[2000] bg-black flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="p-6 border-b border-white/10 flex items-center justify-between bg-black/80 backdrop-blur-md">
            <h3 className="label-caps !text-white !opacity-100 flex items-center space-x-3">
              <Terminal className="w-6 h-6 text-ps-blue" />
              <span>Next Menu Logs</span>
            </h3>
            <button
              onClick={() => setShowLogs(false)}
              className="p-3 rounded-xl bg-white/5 hover:bg-red-500 hover:text-white transition-all border border-white/10"
            >
              <X className="w-8 h-8" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <LogViewer logs={logs} />
          </div>
        </div>
      )}
    </div>
  )
}

export default SettingsView
