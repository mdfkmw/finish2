import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

export default function InviteAcceptPage() {
  const { token } = useParams();
  const [form, setForm] = useState({
    name: '',
    username: '',
    password: '',
    confirm: '',
  });
  const [inviteInfo, setInviteInfo] = useState(null);
  const [loadingInvite, setLoadingInvite] = useState(Boolean(token));
  const [inviteFetchError, setInviteFetchError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    setLoadingInvite(true);
    setInviteFetchError(null);

    fetch(`/api/invitations/${token}`)
      .then(async res => {
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || 'Invitația nu a fost găsită.');
        }
        return res.json();
      })
      .then(data => {
        if (cancelled) return;
        setInviteInfo(data);
      })
      .catch(err => {
        if (cancelled) return;
        setInviteFetchError(err.message || 'Invitația nu a fost găsită.');
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingInvite(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async event => {
    event.preventDefault();
    if (!token) {
      setError('Link de invitație invalid.');
      return;
    }
    if (inviteFetchError) {
      setError(inviteFetchError);
      return;
    }
    if (inviteInfo?.expired) {
      setError('Invitația este expirată. Solicită un link nou administratorului.');
      return;
    }
    if (inviteInfo?.used_at) {
      setError('Această invitație a fost deja folosită.');
      return;
    }
    if (!form.name.trim()) {
      setError('Completează numele.');
      return;
    }
    if (!form.username.trim()) {
      setError('Alege un nume de utilizator.');
      return;
    }
    if (form.username.trim().length < 3) {
      setError('Username-ul trebuie să aibă cel puțin 3 caractere.');
      return;
    }
    if (form.password.length < 8) {
      setError('Parola trebuie să aibă minimum 8 caractere.');
      return;
    }
    if (form.password !== form.confirm) {
      setError('Parolele nu coincid.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          name: form.name.trim(),
          username: form.username.trim(),
          password: form.password,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || 'Nu am putut valida invitația.');
        return;
      }

      setSuccess(true);
    } catch (err) {
      console.error('invite accept failed', err);
      setError('A apărut o eroare neașteptată. Încearcă din nou.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white shadow rounded p-6">
        <h1 className="text-xl font-semibold text-center mb-2">Activare invitație</h1>
        <p className="text-sm text-gray-600 text-center mb-6">
          Completează datele de mai jos pentru a-ți crea contul.
        </p>

        {!token && (
          <div className="text-red-600 text-sm mb-4">Token lipsă sau invalid.</div>
        )}

        {loadingInvite && (
          <div className="text-sm text-gray-500 mb-4">Se verifică invitația…</div>
        )}

        {inviteFetchError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
            {inviteFetchError}
          </div>
        )}

        {inviteInfo && !inviteInfo.expired && !inviteInfo.used_at && (
          <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-xs text-gray-600 mb-4">
            <p>Email: <span className="font-medium">{inviteInfo.email}</span></p>
            {inviteInfo.role && (
              <p>Rol alocat: <span className="font-medium">{inviteInfo.role}</span></p>
            )}
            {inviteInfo.expires_at && (
              <p>
                Valabil până la: <span className="font-medium">{new Date(inviteInfo.expires_at).toLocaleString('ro-RO')}</span>
              </p>
            )}
          </div>
        )}

        {inviteInfo?.expired && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
            Invitația a expirat. Cere administratorului un alt link.
          </div>
        )}

        {inviteInfo?.used_at && (
          <div className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
            Această invitație a fost deja folosită pe {new Date(inviteInfo.used_at).toLocaleString('ro-RO')}.
          </div>
        )}

        {success ? (
          <div className="text-center space-y-4">
            <p className="text-green-600 font-semibold">Cont creat cu succes!</p>
            <p className="text-sm text-gray-700">
              Te poți autentifica acum folosind adresa ta de email și parola setată.
            </p>
            <Link
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded"
              to="/login"
            >
              Mergi la autentificare
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="invite-name">
                Nume complet
              </label>
              <input
                id="invite-name"
                type="text"
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Nume Prenume"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="invite-username">
                Username
              </label>
              <input
                id="invite-username"
                type="text"
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                placeholder="ex: prenume.nume"
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="invite-email">
                Email invitație
              </label>
              <input
                id="invite-email"
                type="email"
                className="w-full border rounded px-3 py-2 text-sm bg-gray-100"
                value={inviteInfo?.email || ''}
                readOnly
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="invite-pass">
                Parolă
              </label>
              <input
                id="invite-pass"
                type="password"
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder="Minim 8 caractere"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="invite-confirm">
                Confirmă parola
              </label>
              <input
                id="invite-confirm"
                type="password"
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.confirm}
                onChange={e => setForm({ ...form, confirm: e.target.value })}
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2 bg-green-600 text-white rounded disabled:opacity-60"
              disabled={
                submitting ||
                !token ||
                Boolean(inviteFetchError) ||
                inviteInfo?.expired ||
                inviteInfo?.used_at
              }
            >
              {submitting ? 'Se confirmă…' : 'Creează contul'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
