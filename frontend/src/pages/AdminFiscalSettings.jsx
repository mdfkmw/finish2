import { useEffect, useState } from 'react';

export default function AdminFiscalSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [receiptNote, setReceiptNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let ignore = false;

    const loadSettings = async () => {
      try {
        const res = await fetch('/api/fiscal-settings');
        if (!res.ok) {
          throw new Error('Nu s-au putut încărca setările fiscale');
        }
        const data = await res.json().catch(() => ({}));
        if (!ignore) {
          setReceiptNote(typeof data?.receipt_note === 'string' ? data.receipt_note : '');
        }
      } catch (err) {
        console.error(err);
        if (!ignore) {
          setError(err.message || 'Nu s-au putut încărca setările fiscale');
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    loadSettings();
    return () => { ignore = true; };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/fiscal-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt_note: receiptNote }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Nu s-au putut salva setările');
      }
      setSuccess('Setările au fost salvate.');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Nu s-au putut salva setările');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Setări fiscalizare</h2>

      {loading ? (
        <div>Se încarcă…</div>
      ) : (
        <form onSubmit={handleSubmit} className="bg-white rounded shadow p-4 space-y-4 max-w-xl">
          <div>
            <label htmlFor="receipt-note" className="block text-sm font-medium text-gray-700">
              Text implicit pe bon fiscal
            </label>
            <input
              id="receipt-note"
              type="text"
              className="mt-1 block w-full border rounded px-3 py-2 text-sm"
              placeholder="ex: Bilet Botoșani → Iași (Agent: nume)"
              value={receiptNote}
              maxLength={120}
              onChange={(e) => setReceiptNote(e.target.value)}
            />
            <p className="mt-1 text-xs text-gray-500">Acest text se adaugă la descrierea tipărită pe bonul fiscal.</p>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}
          {success && <div className="text-sm text-green-600">{success}</div>}

          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-60"
            disabled={saving}
          >
            {saving ? 'Se salvează…' : 'Salvează setările'}
          </button>
        </form>
      )}
    </div>
  );
}
