import React, { useState, useEffect } from 'react'
import { RefreshCw, ArrowLeft, ArrowRight, Activity, Zap, ChevronUp, ChevronDown, Trash2, CheckCircle2, ShieldCheck } from 'lucide-react'
import { cn, isPS5 } from '../../utils/helpers'
import PayloadName from '../ui/PayloadName'
import Modal from '../ui/Modal'

const AutoloadView = ({ payloads, config, onSaveConfig, onToast }) => {
  const [subView, setSubView] = useState('list')
  const [enabled, setEnabled] = useState(false)
  const [autoloadList, setAutoloadList] = useState([])
  const [showDelayModal, setShowDelayModal] = useState(false)
  const [customDelay, setCustomDelay] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config) {
      setEnabled(config.AUTOLOAD_ENABLED === true || config.AUTOLOAD_ENABLED === "true")
      setAutoloadList(config.AUTOLOAD_LIST ? config.AUTOLOAD_LIST.split(',').filter(x => x) : [])
    }
  }, [config])

  const internalPayloads = payloads.filter(p => !p.includes('/mnt/usb')).map(p => p.split('/').pop())
  const availablePayloads = internalPayloads.filter(p => !autoloadList.includes(p))

  const handleToggle = (val) => {
    setEnabled(val)
    onSaveConfig({ AUTOLOAD_ENABLED: val, AUTOLOAD_LIST: autoloadList.join(',') })
  }

  const addPayload = (p) => {
    const isKstuff = p.toLowerCase().includes('kstuff');
    if (isKstuff) {
      const existing = autoloadList.find(x => x.toLowerCase().includes('kstuff'));
      if (existing) {
        onToast(`Conflict: Multiple KStuff payloads detected.`, 'error');
        return;
      }
    }
    setAutoloadList([...autoloadList, p]);
    setSubView('list')
  }

  const addDelay = (ms) => {
    setAutoloadList([...autoloadList, `!${ms}`])
    setShowDelayModal(false)
    setSubView('list')
  }

  const moveUp = (index) => {
    if (index === 0) return
    const newList = [...autoloadList]
      ;[newList[index - 1], newList[index]] = [newList[index], newList[index - 1]]
    setAutoloadList(newList)
  }

  const moveDown = (index) => {
    if (index === autoloadList.length - 1) return
    const newList = [...autoloadList]
      ;[newList[index + 1], newList[index]] = [newList[index], newList[index + 1]]
    setAutoloadList(newList)
  }

  const handleSave = async () => {
    const shouldEnable = autoloadList.length > 0 && enabled
    if (autoloadList.length === 0) setEnabled(false)
    const finalList = autoloadList.map(p => p === 'DELAY' ? '!1000' : p)
    const success = await onSaveConfig({ AUTOLOAD_ENABLED: shouldEnable, AUTOLOAD_LIST: finalList.join(',') })
    if (success) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  const renderAvailable = () => (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {subView === 'add' && (
            <button onClick={() => setSubView('list')} className="p-2 bg-white/5 rounded-xl border border-white/10 md:hidden">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <h3 className="label-caps !text-white !opacity-100 text-xl tracking-widest">Available Payloads</h3>
        </div>
        {subView === 'list' && (
          <button
            onClick={() => handleToggle(false)}
            className="px-6 py-2 rounded-xl font-black uppercase italic tracking-tighter bg-red-600/10 text-red-500 border border-red-500/30 hover:bg-red-600 hover:text-white transition-all shadow-lg text-xs"
          >
            Disable Autoload
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4">
        {availablePayloads.map(p => {
          const isKstuff = p.toLowerCase().includes('kstuff');
          const hasKstuff = autoloadList.some(x => x.toLowerCase().includes('kstuff'));
          const isBlocked = isKstuff && hasKstuff;

          return (
            <button
              key={p}
              onClick={() => !isBlocked && addPayload(p)}
              disabled={isBlocked}
              className={cn(
                "flex items-center justify-between p-6 glass-card rounded-2xl border-white/20 transition-all text-left",
                isBlocked ? "opacity-40 cursor-not-allowed" : "bg-white/[0.03] hover:border-ps-blue group"
              )}
            >
              <PayloadName path={p} className={cn("text-xl", isBlocked ? "text-zinc-500" : "text-white")} />
              <ArrowRight className={cn("w-6 h-6 transition-all", isBlocked ? "text-zinc-800" : "text-zinc-500 group-hover:text-ps-blue group-hover:translate-x-2")} />
            </button>
          )
        })}
        <div className="pt-4 border-t border-white/10 mt-4">
          <button
            onClick={() => setShowDelayModal(true)}
            className="w-full flex items-center justify-between p-6 bg-white/[0.03] rounded-2xl border border-dashed border-white/20 hover:border-ps-blue group transition-all"
          >
            <div className="flex items-center space-x-4">
              <Zap className="w-6 h-6 text-ps-blue" />
              <span className="font-bold text-white uppercase tracking-tight text-xl">Add Delay</span>
            </div>
            <ArrowRight className="w-6 h-6 text-zinc-500 group-hover:text-ps-blue group-hover:translate-x-2 transition-all" />
          </button>
        </div>
      </div>
    </div>
  )

  const renderSequence = () => (
    <div className="space-y-8 animate-fade-in flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between">
        <h2 className="text-4xl font-extrabold text-white tracking-tight">
          Autoload <span className="text-ps-blue">Sequence</span>
        </h2>
        <button
          onClick={() => setSubView('add')}
          className={cn(
            "flex items-center space-x-2 px-6 py-3 bg-ps-blue text-white rounded-xl font-bold uppercase tracking-tight shadow-xl",
            isPS5 ? "hidden" : "md:hidden"
          )}
        >
          <Activity className="w-5 h-5" />
          <span>Add Item</span>
        </button>
      </div>

      <div className="glass-panel p-6 rounded-ps-3xl border-white/10 flex-1 overflow-hidden flex flex-col min-h-[400px]">
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-2 mb-6">
          {autoloadList.map((p, i) => (
            <div key={`${p}-${i}`} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/10 animate-in slide-in-from-left duration-200">
              <div className="flex items-center space-x-4">
                <span className="text-ps-blue font-black italic">{i + 1}</span>
                <PayloadName path={p} className="text-white" />
              </div>
              <div className="flex items-center space-x-2">
                <button onClick={() => moveUp(i)} disabled={i === 0} className="p-2 bg-white/10 text-zinc-400 hover:bg-ps-blue hover:text-white rounded-xl disabled:opacity-5">
                  <ChevronUp className="w-5 h-5" />
                </button>
                <button onClick={() => moveDown(i)} disabled={i === autoloadList.length - 1} className="p-2 bg-white/10 text-zinc-400 hover:bg-ps-blue hover:text-white rounded-xl disabled:opacity-5">
                  <ChevronDown className="w-5 h-5" />
                </button>
                <button onClick={() => setAutoloadList(autoloadList.filter((_, idx) => idx !== i))} className="p-2 bg-white/10 text-zinc-400 hover:bg-red-600 hover:text-white rounded-xl">
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
          {autoloadList.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center opacity-10 italic py-20">
              <RefreshCw className="w-16 h-16 mb-4" />
              <p className="text-2xl font-bold">Sequence Empty</p>
            </div>
          )}
        </div>

        <button
          onClick={handleSave}
          className={cn(
            "w-full py-5 rounded-2xl font-bold tracking-tight text-xl transition-all shadow-2xl flex items-center justify-center space-x-3",
            saved ? "bg-emerald-600 text-white" : "bg-ps-blue hover:bg-ps-blue/80 text-white"
          )}
        >
          {saved ? <CheckCircle2 className="w-6 h-6" /> : <ShieldCheck className="w-6 h-6" />}
          <span>{saved ? "Configuration Saved" : "Save Sequence"}</span>
        </button>
      </div>
    </div>
  )

  if (!enabled) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center space-y-8 animate-fade-in text-center p-6 md:p-12">
        <div className="relative h-24 w-24 md:h-32 md:w-32 mx-auto">
          <div className="absolute inset-0 bg-ps-blue/20 blur-3xl rounded-full animate-pulse" />
          <div className="relative flex items-center justify-center h-full w-full bg-black/40 border border-white/10 rounded-3xl md:rounded-[2.5rem] shadow-2xl">
            <RefreshCw className="w-10 h-10 md:w-16 md:h-16 text-ps-blue" />
          </div>
        </div>
        <div className="space-y-3 md:space-y-4 px-4 max-w-2xl">
          <h2 className="text-3xl md:text-5xl font-black text-white uppercase italic tracking-tighter">
            Autoload <span className="text-ps-blue">Sequence</span>
          </h2>
          <p className="text-md md:text-xl text-zinc-400 font-medium leading-relaxed">
            Chain multiple payloads to be executed automatically every time Next Menu starts.
          </p>
        </div>
        <button
          onClick={() => handleToggle(true)}
          className="px-8 md:px-12 py-5 md:py-6 bg-ps-blue text-white text-lg md:text-2xl font-extrabold rounded-2xl md:rounded-[1.5rem] hover:bg-ps-blue/80 transition-all transform active:scale-95 shadow-[0_0_40px_rgba(0,149,255,0.3)]"
        >
          Enable Autoload
        </button>
      </div>
    )
  }

  return (
    <div className={cn(
      "overflow-hidden md:overflow-visible animate-fade-in",
      isPS5 ? "h-full" : "h-[calc(100vh-250px)] md:h-auto"
    )}>
      <div className={cn(
        "gap-12 items-start h-full",
        isPS5 ? "grid grid-cols-2" : "hidden md:grid md:grid-cols-2"
      )}>
        {renderAvailable()}
        {renderSequence()}
      </div>
      <div className={cn(
        "h-full flex flex-col",
        isPS5 ? "hidden" : "md:hidden"
      )}>
        {subView === 'list' ? renderSequence() : renderAvailable()}
      </div>

      <Modal
        show={showDelayModal}
        title="Configure Delay"
        onClose={() => setShowDelayModal(false)}
        footer={
          <button
            onClick={() => setShowDelayModal(false)}
            className="w-full py-4 bg-white/5 hover:bg-white/10 text-white rounded-2xl font-bold uppercase tracking-tight transition-all"
          >
            Cancel
          </button>
        }
      >
        <div className="space-y-8">
          <div className="grid grid-cols-3 gap-4">
            {[1, 3, 5].map(s => (
              <button
                key={s}
                onClick={() => addDelay(s * 1000)}
                className="py-6 bg-ps-blue/20 hover:bg-ps-blue border border-ps-blue/30 text-white rounded-2xl font-black text-2xl transition-all shadow-lg"
              >
                {s}s
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <p className="label-caps !text-zinc-500">Custom Delay (milliseconds)</p>
            <div className="flex space-x-4">
              <input
                type="number"
                placeholder="e.g. 2500"
                value={customDelay}
                onChange={(e) => setCustomDelay(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-5 text-white font-mono text-2xl focus:border-ps-blue outline-none transition-all"
              />
              <button
                onClick={() => customDelay && addDelay(parseInt(customDelay))}
                className="px-10 bg-ps-blue text-white rounded-2xl font-black uppercase italic tracking-tighter text-xl shadow-2xl hover:bg-ps-blue/80 transition-all"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default AutoloadView
