import React, { useState, useEffect, useRef } from 'react'
import { ChevronDown } from 'lucide-react'

const LogViewer = ({ logs }) => {
  const scrollRef = useRef(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [hasNewLogs, setHasNewLogs] = useState(false)

  const handleScroll = () => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    const atBottom = scrollHeight - scrollTop - clientHeight < 100
    setIsAtBottom(atBottom)
    if (atBottom) setHasNewLogs(false)
  }

  useEffect(() => {
    if (isAtBottom) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'auto' })
    } else {
      setHasNewLogs(true)
    }
  }, [logs, isAtBottom])

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    setIsAtBottom(true)
    setHasNewLogs(false)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col relative group h-full">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-1 custom-scrollbar scroll-smooth"
      >
        {logs.map((log, i) => (
          <div key={i} className="flex space-x-3 opacity-90 border-l-2 border-transparent hover:border-ps-blue hover:bg-white/5 px-2 transition-all">
            <span className="text-zinc-600 select-none font-bold shrink-0 w-8">{i + 1}</span>
            <span className="text-ps-blue/60 font-bold">»</span>
            <span className="text-zinc-300 break-all leading-relaxed">{log}</span>
          </div>
        ))}
      </div>

      {!isAtBottom && hasNewLogs && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 bg-ps-blue text-white rounded-full font-bold uppercase tracking-widest text-[10px] z-50 flex items-center space-x-2 border border-white/20 shadow-2xl animate-bounce"
        >
          <ChevronDown className="w-4 h-4" />
          <span>New Activity Below</span>
        </button>
      )}
    </div>
  )
}

export default LogViewer
