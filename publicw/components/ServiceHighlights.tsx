export default function ServiceHighlights() {
  const highlights = [
    {
      title: 'Disponibilitate sincronizată',
      description:
        'Locurile rezervate de operatori apar instant și pe site, iar selecțiile tale blochează locurile în aplicația internă timp de câteva minute.',
    },
    {
      title: 'Confirmare rapidă',
      description:
        'Primești mesaj de confirmare pe e-mail sau telefon. Echipa PRIS COM validează fiecare rezervare și îți oferă suport în cel mai scurt timp.',
    },
    {
      title: 'Optimizat pentru mobil',
      description:
        'Interfața este gândită pentru utilizatorii care rezervă din mers. Navighezi ușor între trasee și finalizezi rezervarea în câteva tap-uri.',
    },
  ]

  return (
    <section className="max-w-6xl mx-auto px-4 py-12 md:py-16">
      <div className="grid lg:grid-cols-3 gap-6 md:gap-8">
        {highlights.map((item) => (
          <article key={item.title} className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-6 space-y-3 shadow-soft">
            <h3 className="text-xl font-semibold text-white">{item.title}</h3>
            <p className="text-white/70 text-sm leading-relaxed">{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
