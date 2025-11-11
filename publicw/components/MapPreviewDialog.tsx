'use client'

export type MapPreviewData = {
  title: string
  subtitle?: string | null
  embedUrl: string
  directUrl?: string | null
}

type MapPreviewDialogProps = {
  data: MapPreviewData | null
  onClose: () => void
}

export default function MapPreviewDialog({ data, onClose }: MapPreviewDialogProps) {
  if (!data) return null

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center px-4 py-6">
        <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-[#101827] ring-1 ring-white/15 shadow-[0_25px_50px_-12px_rgba(15,23,42,0.75)]">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-white truncate" title={data.title}>
                {data.title}
              </h3>
              {data.subtitle && (
                <p className="text-sm text-white/60 mt-1 truncate" title={data.subtitle ?? undefined}>
                  {data.subtitle}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-white/60 hover:text-white text-xl leading-none"
              aria-label="Închide harta"
            >
              ×
            </button>
          </div>
          <div className="aspect-[4/3] w-full bg-black">
            <iframe
              src={data.embedUrl}
              className="h-full w-full border-0"
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title={data.title}
            />
          </div>
          {data.directUrl && (
            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-3 text-xs text-white/60">
              <span>Poți deschide locația și în Google Maps pentru navigație.</span>
              <a
                href={data.directUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                Deschide în Google Maps
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
