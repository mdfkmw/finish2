import Navbar from '@/components/Navbar'

export const metadata = {
  title: 'Contact - Pris Com',
  description: 'Informații de contact pentru agențiile Pris Com și rezervări speciale.',
}

const contactEntries = [
  { label: 'Agenție Iași', value: '0740 470 996', href: 'tel:0740470996' },
  { label: 'Agenție Botoșani', value: '0744 622 282', href: 'tel:0744622282' },
  { label: 'Agenție Hârlău', value: '0749 321 076', href: 'tel:0749321076' },
]

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-slatebg text-white">
      <Navbar />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <p className="text-sm uppercase tracking-wide text-white/50">Contact</p>
          <h1 className="mt-2 text-3xl font-semibold md:text-4xl">Suntem la un telefon distanță</h1>
          <p className="mt-3 text-sm text-white/70">
            Alege agenția cea mai apropiată pentru rezervări și informații despre cursele Pris Com sau contactează-ne prin email.
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <h2 className="text-lg font-semibold">Agențiile Pris Com</h2>
            <ul className="mt-4 space-y-4 text-sm text-white/70">
              {contactEntries.map((entry) => (
                <li key={entry.label} className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-white/40">{entry.label}</span>
                  <a
                    href={entry.href}
                    className="text-base font-semibold text-white hover:text-brand focus:text-brand focus:outline-none"
                  >
                    {entry.value}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Rezervări și suport</h2>
              <p className="mt-2 text-sm text-white/70">
                Trimite-ne un email la{' '}
                <a href="mailto:rezervari@pris-com.ro" className="font-semibold text-white hover:text-brand">
                  rezervari@pris-com.ro
                </a>
                {' '}pentru informații generale despre bilete și rezervări online.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-4">
              <h3 className="text-base font-semibold text-white">Închirieri autobuze și microbuze</h3>
              <p className="mt-2 text-sm text-white/70">
                Pentru solicitări speciale și închirieri, sună la{' '}
                <a href="tel:0743040903" className="font-semibold text-white hover:text-brand">
                  0743 040 903
                </a>
                .
              </p>
            </div>
            <p className="text-xs text-white/50">
              Programul agențiilor poate varia în funcție de sezon. Pentru confirmări rapide, recomandăm apelarea directă a agenției.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
