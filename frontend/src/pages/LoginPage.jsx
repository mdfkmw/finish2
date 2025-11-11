// File: src/pages/LoginPage.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function LoginPage({ onLoggedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok !== true) {
        setErr(data?.error || 'Email sau parolă greșite.');
      } else {
        // opțional: cere /me ca să aflăm rolul
        const me = await fetch('/api/auth/me', { credentials: 'include' })
          .then(r => r.json())
          .catch(() => ({ user: null }));
        onLoggedIn?.(me?.user || null);
        navigate('/', { replace: true });
      }
    } catch {
      setErr('Eroare la autentificare.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto mt-10 p-6 rounded border bg-white">
      <h1 className="text-xl font-semibold mb-4">Autentificare</h1>
      {err && <div className="mb-3 text-sm text-red-600">{err}</div>}
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Email sau telefon</span>
          <input
            className="border rounded px-3 py-2"
            type="text"
            autoComplete="username"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm">Parolă</span>
          <input
            className="border rounded px-3 py-2"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="mt-2 bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 disabled:opacity-60"
        >
          {busy ? 'Se conectează…' : 'Login'}
        </button>
      </form>
    </div>
  );
}
