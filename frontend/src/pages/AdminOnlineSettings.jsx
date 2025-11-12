import { useEffect, useState } from 'react';

const MIN_LEAD_MAX_MINUTES = 60 * 24 * 7; // 7 zile
const MAX_ADVANCE_MAX_DAYS = 365;

function normalizeNumber(value, fallback = 0, max = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  const rounded = Math.floor(parsed);
  if (max !== null && rounded > max) return max;
  return rounded;
}

export default function AdminOnlineSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [blockPastReservations, setBlockPastReservations] = useState(true);
  const [minLeadMinutes, setMinLeadMinutes] = useState(0);
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch('/api/online-settings');
        if (!response.ok) {
          throw new Error('Nu s-au putut încărca setările online.');
        }
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        setBlockPastReservations(Boolean(data?.block_past_reservations));
        setMinLeadMinutes(normalizeNumber(data?.public_min_lead_minutes, 0, MIN_LEAD_MAX_MINUTES));
        setMaxAdvanceDays(normalizeNumber(data?.public_max_advance_days, 0, MAX_ADVANCE_MAX_DAYS));
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(err.message || 'Nu s-au putut încărca setările online.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    const payload = {
      block_past_reservations: blockPastReservations,
      public_min_lead_minutes: normalizeNumber(minLeadMinutes, 0, MIN_LEAD_MAX_MINUTES),
      public_max_advance_days: normalizeNumber(maxAdvanceDays, 0, MAX_ADVANCE_MAX_DAYS),
    };

    try {
      const response = await fetch('/api/online-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Nu s-au putut salva setările.');
      }
      setSuccess('Setările au fost salvate.');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Nu s-au putut salva setările.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Setări rezervări online</h2>
      {loading ? (
        <div>Se încarcă…</div>
      ) : (
        <form onSubmit={handleSubmit} className="max-w-2xl space-y-6 rounded bg-white p-5 shadow">
          <div className="flex items-start gap-3">
            <input
              id="block-past-reservations"
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={blockPastReservations}
              onChange={(event) => setBlockPastReservations(event.target.checked)}
            />
            <div>
              <label htmlFor="block-past-reservations" className="block text-sm font-medium text-gray-800">
                Blochează rezervările pentru curse din trecut
              </label>
              <p className="text-sm text-gray-500">
                Atunci când este activată, nici aplicația internă și nici site-ul public nu mai permit adăugarea de rezervări
                după ora plecării cursei.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="min-lead" className="block text-sm font-medium text-gray-800">
                Interval minim înainte de plecare (minute)
              </label>
              <input
                id="min-lead"
                type="number"
                min={0}
                max={MIN_LEAD_MAX_MINUTES}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
                value={minLeadMinutes}
                onChange={(event) =>
                  setMinLeadMinutes(
                    normalizeNumber(event.target.value === '' ? 0 : event.target.value, 0, MIN_LEAD_MAX_MINUTES)
                  )
                }
              />
              <p className="mt-1 text-xs text-gray-500">
                Rezervările online vor fi oprite cu acest număr de minute înainte de plecare. Setează 0 pentru a dezactiva limita.
              </p>
            </div>
            <div>
              <label htmlFor="max-advance" className="block text-sm font-medium text-gray-800">
                Interval maxim în avans (zile)
              </label>
              <input
                id="max-advance"
                type="number"
                min={0}
                max={MAX_ADVANCE_MAX_DAYS}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
                value={maxAdvanceDays}
                onChange={(event) =>
                  setMaxAdvanceDays(
                    normalizeNumber(event.target.value === '' ? 0 : event.target.value, 0, MAX_ADVANCE_MAX_DAYS)
                  )
                }
              />
              <p className="mt-1 text-xs text-gray-500">
                Permite rezervări doar cu un număr limitat de zile înainte de plecare. Setează 0 pentru a permite orice dată din viitor.
              </p>
            </div>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}
          {success && <div className="text-sm text-green-600">{success}</div>}

          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
            disabled={saving}
          >
            {saving ? 'Se salvează…' : 'Salvează setările'}
          </button>
        </form>
      )}
    </div>
  );
}
