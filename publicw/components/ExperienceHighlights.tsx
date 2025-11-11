export default function ExperienceHighlights() {
  const highlights = [
    {
      title: 'Ghid pas cu pas pentru mobil',
      description:
        'Elementele importante sunt grupate vertical, butoanele sunt mari și ușor de apăsat, iar rezumatul rezervării rămâne la vedere pe ecrane mici.',
      icon: '📱',
    },
    {
      title: 'Locuri în timp real',
      description:
        'Vezi în câteva secunde locurile disponibile și poziția lor în autobuz, inclusiv dacă sunt ocupate parțial sau blocate.',
      icon: '🪑',
    },
    {
      title: 'Reduceri din baza de date',
      description:
        'Codurile promoționale sunt validate direct pe server, cu limite și perioade de valabilitate, astfel încât primești exact reducerea disponibilă.',
      icon: '💳',
    },
  ]

  return (
    <section className="max-w-6xl mx-auto px-4 py-14 md:py-20" id="rezervari">
      <div className="grid gap-10 md:grid-cols-[1.1fr_0.9fr] items-center">
        <div className="space-y-6">
          <h2 className="text-3xl md:text-4xl font-extrabold">Creat special pentru călători ocupați</h2>
          <p className="text-white/70 text-base md:text-lg leading-relaxed">
            Am eliminat mesajele inutile și am păstrat doar ce contează: o căutare rapidă, un mod clar de selectare a
            locurilor și confirmare instant. Totul funcționează identic pe desktop și pe mobil, fără scroll-uri infinite.
          </p>
          <ul className="space-y-4">
            {highlights.map((item) => (
              <li
                key={item.title}
                className="flex items-start gap-4 rounded-2xl bg-white/5 border border-white/10 p-5"
              >
                <span className="text-2xl" aria-hidden>
                  {item.icon}
                </span>
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="text-sm text-white/70 leading-relaxed">{item.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative">
          <div className="absolute inset-0 bg-brand/30 blur-3xl rounded-full" aria-hidden />
          <div className="relative rounded-3xl overflow-hidden ring-1 ring-white/10 shadow-[0_25px_50px_-12px_rgba(46,203,198,0.35)]">
            <div className="aspect-[4/5] bg-gradient-to-br from-brand/60 via-emerald-500/30 to-slate-900" />
            <div className="absolute bottom-6 left-6 right-6 bg-black/60 backdrop-blur-md rounded-2xl p-5 border border-white/10">
              <div className="text-white font-semibold text-lg">Rezumat pe scurt</div>
              <p className="text-white/70 text-sm mt-1">
                Subtotal, reducere și total final se actualizează imediat ce alegi sau elimini un loc. Nu există taxe ascunse
                și primești confirmarea pe loc.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
