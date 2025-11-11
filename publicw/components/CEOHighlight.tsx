export default function CEOHighlight() {
  return (
    <section className="max-w-6xl mx-auto px-4 py-16 md:py-20">
      <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-10 items-center">
        <div className="space-y-6">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand/15 text-brand text-sm font-semibold">
            Mesajul CEO-ului
          </span>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white">
            „Am construit PRIS COM Travel pentru oameni, cu grijă pentru fiecare călător.”
          </h2>
          <p className="text-white/70 text-base md:text-lg leading-relaxed">
            În fiecare zi ne asigurăm că rutele noastre funcționează la standarde înalte, iar echipa noastră este acolo unde
            pasagerii au nevoie. CEO-ul nostru conduce personal proiectele cheie și urmărește cu atenție calitatea fiecărei
            curse, pentru ca experiența ta să fie sigură, confortabilă și punctuală.
          </p>
          <div className="rounded-2xl bg-white/10 border border-white/10 p-6 space-y-4">
            <p className="text-white/80 text-sm md:text-base">
              „Rezervările online ne permit să fim și mai aproape de pasageri. Platforma aceasta este felul meu de a garanta că
              fiecare loc ales reflectă promisiunea noastră de respect, transparență și profesionalism.”
            </p>
            <div className="flex items-center gap-4">
              <div className="size-12 rounded-full bg-brand/20 grid place-items-center text-brand text-xl font-bold">
                CEO
              </div>
              <div>
                <div className="text-white font-semibold">CEO PRIS COM Travel</div>
                <div className="text-white/60 text-sm">Coordonează personal operațiunile zilnice</div>
              </div>
            </div>
          </div>
        </div>
        <div className="relative">
          <div className="absolute inset-0 bg-brand/30 blur-3xl rounded-full" aria-hidden />
          <div className="relative rounded-3xl overflow-hidden ring-1 ring-white/10 shadow-[0_25px_50px_-12px_rgba(59,130,246,0.45)]">
            <div className="aspect-[4/5] bg-gradient-to-br from-brand/70 via-emerald-500/40 to-slate-900" />
            <div className="absolute bottom-6 left-6 right-6 bg-black/60 backdrop-blur-md rounded-2xl p-5 border border-white/10">
              <div className="text-white font-semibold text-lg">Leadership activ</div>
              <p className="text-white/70 text-sm mt-1">
                CEO-ul nostru urmărește personal indicatorii de satisfacție și intervine când este nevoie. Platforma de rezervări
                este construită ca să reflecte această implicare directă.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
