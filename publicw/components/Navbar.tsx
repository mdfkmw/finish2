'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

import { usePublicSession } from '@/components/PublicSessionProvider'

const baseLinks = [
  { href: '/', label: 'Acasă' },
  { href: '/#trasee', label: 'Trasee' },
  { href: '/contact', label: 'Contact' },
]

const NAV_ITEM_CLASS =
  'group relative block px-3 py-2 rounded-lg text-sm md:text-base text-white/80 hover:text-white transition'

const NavHighlight = () => (
  <>
    <span
      aria-hidden
      className="pointer-events-none absolute left-3 -bottom-0.5 h-[2px] rounded-full bg-gradient-to-r from-brand to-brandTeal origin-left w-[calc(100%-1.5rem)] transition-transform duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] scale-x-0 group-hover:scale-x-100"
    />
    <span
      aria-hidden
      className="pointer-events-none absolute left-3 -bottom-0.5 h-[6px] rounded-full blur-sm opacity-0 bg-gradient-to-r from-brand/60 to-brandTeal/60 origin-left w-[calc(100%-1.5rem)] transition-all duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] scale-x-0 group-hover:opacity-100 group-hover:scale-x-100"
    />
  </>
)

const NavLink = ({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) => (
  <Link href={href} onClick={onClick} className={NAV_ITEM_CLASS}>
    {children}
    <NavHighlight />
  </Link>
)

const NavButton = ({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`${NAV_ITEM_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
  >
    {children}
    <NavHighlight />
  </button>
)

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const router = useRouter()
  const { session, logout, refresh } = usePublicSession()

  const isAuthenticated = Boolean(session)

  const handleLogout = async () => {
    if (logoutPending) return
    setLogoutError(null)
    setLogoutPending(true)
    try {
      await logout()
      setOpen(false)
      router.push('/')
    } catch (err: any) {
      const message = err?.message || 'Nu am putut finaliza deconectarea. Încearcă din nou.'
      setLogoutError(message)
      try {
        await refresh()
      } catch (refreshErr) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[navbar] refresh after failed logout', refreshErr)
        }
      }
    } finally {
      setLogoutPending(false)
    }
  }

  return (
    <header className="w-full sticky top-0 z-30 backdrop-blur supports-[backdrop-filter]:bg-black/40">
      <div className="max-w-6xl mx-auto flex items-center justify-between py-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-white">
          <Image
            src="/sigla.png"
            alt="Sigla Pris Com"
            width={80}
            height={80}
            className="h-10 w-30"
            priority
            unoptimized
          />
          <span className="text-xl brand-wordmark">
            Pris Com
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {baseLinks.map((link) => (
            <NavLink key={link.href} href={link.href}>
              {link.label}
            </NavLink>
          ))}
          {isAuthenticated ? (
            <>
              <NavLink href="/account">Contul meu</NavLink>
              <NavButton onClick={handleLogout} disabled={logoutPending}>
                {logoutPending ? 'Se deloghează…' : 'Logout'}
              </NavButton>
            </>
          ) : (
            <>
              <NavLink href="/login">Autentificare</NavLink>
              <NavLink href="/register">Înregistrare</NavLink>
            </>
          )}
        </nav>
        <button
          type="button"
          className="md:hidden inline-flex items-center justify-center rounded-xl bg-white/10 px-3 py-2 text-sm text-white/80 hover:text-white hover:bg-white/20 transition"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label="Deschide meniul"
        >
          <span className="sr-only">Meniu</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="size-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            {open ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>
      {open && (
        <div
          id="mobile-nav"
          className="md:hidden px-4 pb-4"
        >
          <div className="rounded-2xl border border-white/10 bg-black/50 backdrop-blur p-3 space-y-1">
            {baseLinks.map((link) => (
              <NavLink key={link.href} href={link.href} onClick={() => setOpen(false)}>
                {link.label}
              </NavLink>
            ))}
            {isAuthenticated ? (
              <>
                <NavLink href="/account" onClick={() => setOpen(false)}>
                  Contul meu
                </NavLink>
                <NavButton onClick={handleLogout} disabled={logoutPending}>
                  {logoutPending ? 'Se deloghează…' : 'Logout'}
                </NavButton>
              </>
            ) : (
              <>
                <NavLink href="/login" onClick={() => setOpen(false)}>
                  Autentificare
                </NavLink>
                <NavLink href="/register" onClick={() => setOpen(false)}>
                  Înregistrare
                </NavLink>
              </>
            )}
          </div>
        </div>
      )}
      {logoutError && (
        <div className="px-4 pb-3 text-sm text-rose-300 md:text-center">{logoutError}</div>
      )}
    </header>
  )
}
