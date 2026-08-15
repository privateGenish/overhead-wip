/**
 * A face for the account, generated from the name.
 *
 * No avatar library and no uploaded image: a name is the only thing this app
 * asks for, and initials on a colour derived from that name give everyone a
 * distinct mark for free. Deterministic, so it never changes underfoot — the
 * same name always produces the same avatar.
 *
 * The colour is picked in oklch at fixed lightness and low chroma, so whatever
 * hue a name lands on stays in the app's quiet register instead of shouting.
 */

/** FNV-1a, small and stable — the only property that matters is determinism. */
function hash(text: string): number {
  let value = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

/** Up to two letters: initials for "Ada Lovelace", the first two otherwise. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '·'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

const SIZES = {
  sm: 'size-8 text-xs',
  md: 'size-12 text-sm',
} as const

interface AccountAvatarProps {
  name: string
  size?: keyof typeof SIZES
}

export function AccountAvatar({ name, size = 'md' }: AccountAvatarProps) {
  const hue = hash(name.trim().toLowerCase()) % 360
  const empty = name.trim() === ''

  return (
    <div
      aria-hidden
      className={`${SIZES[size]} shrink-0 rounded-full flex items-center justify-center font-medium tracking-wide ring-1 ring-foreground/10 select-none`}
      style={
        empty
          // Nothing to derive a colour from yet — stay neutral rather than
          // inventing an identity for the empty string.
          ? { background: 'var(--muted)', color: 'var(--muted-foreground)' }
          : { background: `oklch(0.62 0.09 ${hue})`, color: `oklch(0.98 0.01 ${hue})` }
      }
    >
      {initialsOf(name)}
    </div>
  )
}
