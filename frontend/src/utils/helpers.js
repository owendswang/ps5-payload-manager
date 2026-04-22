import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const isPS5 = /PlayStation/i.test(navigator.userAgent);

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export const parsePayloadName = (path) => {
  if (!path) return { displayName: '', version: null };
  if (path.startsWith('!')) {
    const ms = parseInt(path.substring(1));
    return { displayName: `Delay (${ms / 1000}s)`, version: null, isDelay: true };
  }

  let name = path.split('/').pop().replace(/\.(elf|bin|lua)$/i, '');

  // Try to find version pattern like _v1.0 or -v1.0 or _1.0
  const versionMatch = name.match(/[_-](v?\d+[\d.a-z-]+)/i);
  let version = null;

  if (versionMatch) {
    version = versionMatch[1];
    name = name.replace(versionMatch[0], '');
  }

  return {
    displayName: name.replace(/_/g, ' ').replace(/-/g, ' '),
    version: version,
    isDelay: false
  };
};
