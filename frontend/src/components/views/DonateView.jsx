import React from 'react'
import { Heart } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { isPS5 } from '../../utils/helpers'

const DonateView = () => {
  const donateUrl = 'https://github.com/itsPLK/ps5_next_menu/blob/main/DONATE.md';
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-8 md:space-y-12 animate-fade-in max-w-4xl mx-auto py-10 md:py-20">
      <div className="p-8 md:p-12 rounded-[2.5rem] md:rounded-[3.5rem] bg-red-600/10 border border-red-600/20 text-red-500 shadow-2xl">
        <Heart className="w-16 h-16 md:w-24 md:h-24 fill-current animate-pulse" />
      </div>
      <div className="space-y-4 md:space-y-6 px-4">
        <h3 className="text-4xl md:text-6xl font-black text-white uppercase italic tracking-tighter">Support <span className="text-red-500">Project</span></h3>
        <p className="text-lg md:text-2xl text-zinc-400 font-medium leading-relaxed italic">
          Maintaining Next Menu takes significant time and effort. Your support helps keep the project alive and free for everyone. It's much appreciated!
        </p>
      </div>

      {isPS5 ? (
        <div className="bg-white p-6 md:p-8 rounded-[2rem] md:rounded-[3rem] shadow-[0_0_60px_rgba(220,38,38,0.3)] mx-4">
          <QRCodeSVG value={donateUrl} size={isPS5 ? 250 : 180} level="H" />
        </div>
      ) : (
        <a
          href={donateUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-10 md:px-16 py-6 md:py-8 bg-red-600 text-white text-xl md:text-3xl font-black uppercase rounded-2xl md:rounded-[2rem] hover:bg-red-500 transition-all transform active:scale-95 shadow-[0_0_50px_rgba(220,38,38,0.4)]"
        >
          View Donation Options
        </a>
      )}
    </div>
  )
}

export default DonateView
