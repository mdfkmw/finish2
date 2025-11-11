import React, { useEffect, useState, useMemo } from 'react';

export default function AdminEmployees() {
  const [employees, setEmployees] = useState([]);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentRole, setCurrentRole] = useState(null);

  // modal state
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    id: null,
    name: '',
    username: '',
    phone: '',
    email: '',
    role: 'driver',
    active: true,
    operator_id: null,
  });

  // invitation state
  const [inviteForm, setInviteForm] = useState({
    email: '',
    role: 'agent',
    operator_id: null,
    ttl_hours: 72,
  });
  const [inviteLink, setInviteLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [inviteError, setInviteError] = useState(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteEmailSent, setInviteEmailSent] = useState(false);
  const [lastInviteEmail, setLastInviteEmail] = useState(null);

  // sorting state
  const [sortConfig, setSortConfig] = useState({ key: 'id', direction: 'asc' });

  useEffect(() => {
    fetchAll();
    fetchOperators();
    loadRole();
  }, []);

  const fetchAll = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/employees?active=all');
      if (!res.ok) throw new Error('Nu am putut încărca angajații');
      const data = await res.json();
      setEmployees(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('fetchAll employees failed', err);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchOperators = async () => {
    try {
      const res = await fetch('/api/operators');
      if (!res.ok) throw new Error('Nu am putut încărca operatorii');
      const data = await res.json();
      setOperators(Array.isArray(data) ? data : []);
      const defaultOperator = (Array.isArray(data) && data[0]?.id) || null;
      setForm(f => ({ ...f, operator_id: f.operator_id ?? defaultOperator }));
      setInviteForm(f => ({ ...f, operator_id: f.operator_id ?? defaultOperator }));
    } catch (err) {
      console.error('fetchOperators failed', err);
      setOperators([]);
    }
  };

  const loadRole = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setCurrentRole(data?.user?.role ?? null);
      }
    } catch (err) {
      console.error('loadRole failed', err);
      setCurrentRole(null);
    }
  };

  const openNew = () => {
    setForm({
      id: null,
      name: '',
      username: '',
      phone: '',
      email: '',
      role: 'driver',
      active: true,
      operator_id: operators[0]?.id ?? null,
    });
    setShowModal(true);
  };

  const openEdit = emp => {
    setForm({
      ...emp,
      username: emp.username ?? '',
    });
    setShowModal(true);
  };

  const closeModal = () => setShowModal(false);

  const save = async () => {
    const payload = {
      ...form,
      username: form.username && form.username.trim() ? form.username.trim() : null,
      operator_id: form.operator_id ? Number(form.operator_id) : null,
      active: form.active ? 1 : 0,
    };

    const method = form.id ? 'PUT' : 'POST';
    const url = form.id ? `/api/employees/${form.id}` : `/api/employees`;

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error('save failed', await res.text());
      return;
    }
    await fetchAll();
    closeModal();
  };

  const remove = async id => {
    if (!window.confirm('Șterge angajatul?')) return;
    await fetch(`/api/employees/${id}`, { method: 'DELETE' });
    fetchAll();
  };

  const createInvitation = async event => {
    event.preventDefault();
    const trimmedEmail = inviteForm.email.trim();
    if (!trimmedEmail) {
      setInviteError('Completează emailul destinatarului.');
      return;
    }

    setCreatingInvite(true);
    setInviteError(null);
    setInviteLink(null);
    setCopied(false);
    setInviteEmailSent(false);
    setLastInviteEmail(null);

    try {
      const payload = {
        email: trimmedEmail,
        role: inviteForm.role,
        ttl_hours: Number(inviteForm.ttl_hours) || 72,
      };

      if (inviteForm.operator_id) {
        payload.operator_id = Number(inviteForm.operator_id);
      }

      const res = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        setInviteError(text || 'Nu am putut genera invitația.');
        return;
      }

      const data = await res.json();
      const link = data?.invite_url || `${window.location.origin}/invita/${data.token}`;
      setInviteLink(link);
      setInviteEmailSent(Boolean(data?.email_sent));
      setLastInviteEmail(trimmedEmail || null);
      setInviteForm(f => ({ ...f, email: '' }));
    } catch (err) {
      console.error('createInvitation failed', err);
      setInviteError('A apărut o eroare la generarea invitației.');
    } finally {
      setCreatingInvite(false);
    }
  };

  // Handle sorting
  const requestSort = key => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedEmployees = useMemo(() => {
    const sortable = [...employees];
    sortable.sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];
      if (aVal === null || typeof aVal === 'undefined') aVal = '';
      if (bVal === null || typeof bVal === 'undefined') bVal = '';
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sortable;
  }, [employees, sortConfig]);

  if (loading) return <p>Se încarcă angajații…</p>;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Angajați</h2>
      <button
        onClick={openNew}
        className="mb-4 px-3 py-1 text-sm bg-green-600 text-white rounded"
      >
        + Adaugă
      </button>

      <div className="overflow-x-auto">
        <table className="w-auto text-sm table-auto border-collapse">
          <thead>
            <tr>
              <th
                onClick={() => requestSort('id')}
                className="p-1 border text-left cursor-pointer select-none"
              >
                # {sortConfig.key === 'id' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th
                onClick={() => requestSort('name')}
                className="p-1 border text-left cursor-pointer select-none"
              >
                Nume {sortConfig.key === 'name' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th
                onClick={() => requestSort('username')}
                className="p-1 border text-left cursor-pointer select-none"
              >
                Utilizator {sortConfig.key === 'username' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th
                onClick={() => requestSort('phone')}
                className="p-1 border text-left cursor-pointer select-none"
              >
                Telefon {sortConfig.key === 'phone' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th
                onClick={() => requestSort('email')}
                className="p-1 border text-left cursor-pointer select-none"
              >
                Email {sortConfig.key === 'email' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th
                onClick={() => requestSort('role')}
                className="p-1 border text-left cursor-pointer select-none"
              >
                Rol {sortConfig.key === 'role' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th
                onClick={() => requestSort('active')}
                className="p-1 border text-left cursor-pointer select-none"
              >
                Activ {sortConfig.key === 'active' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th
                onClick={() => requestSort('operator_id')}
                className="p-1 border text-left cursor-pointer select-none"
              >
                Operator {sortConfig.key === 'operator_id' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th className="p-1 border text-left">Acțiuni</th>
            </tr>
          </thead>
          <tbody>
            {sortedEmployees.map((emp, idx) => (
              <tr
                key={emp.id}
                className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${emp.active ? '' : 'opacity-60'}`}
              >
                <td className="p-1 border">{emp.id}</td>
                <td className="p-1 border">{emp.name}</td>
                <td className="p-1 border">{emp.username || '—'}</td>
                <td className="p-1 border">{emp.phone || '—'}</td>
                <td className="p-1 border">{emp.email || '—'}</td>
                <td className="p-1 border">{emp.role}</td>
                <td className="p-1 border">
                  <input
                    type="checkbox"
                    checked={Boolean(emp.active)}
                    onChange={async () => {
                      await fetch(
                        `/api/employees/${emp.id}`,
                        {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ active: !emp.active }),
                        }
                      );
                      fetchAll();
                    }}
                  />
                </td>
                <td className="p-1 border">
                  {operators.find(o => o.id === emp.operator_id)?.name || '—'}
                </td>
                <td className="p-1 border space-x-2">
                  <button
                    onClick={() => openEdit(emp)}
                    className="px-2 py-1 text-xs bg-blue-500 text-white rounded"
                  >
                    Editează
                  </button>
                  <button
                    onClick={() => remove(emp.id)}
                    className="px-2 py-1 text-xs bg-red-500 text-white rounded"
                  >
                    Șterge
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center">
          <div className="bg-white p-6 rounded shadow-lg w-80">
            <h3 className="mb-4 text-lg font-semibold">
              {form.id ? 'Editează' : 'Adaugă'} angajat
            </h3>

            <label className="block mb-2 text-sm">
              Nume
              <input
                className="w-full p-2 border rounded text-sm"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="block mb-2 text-sm">
              Utilizator (username)
              <input
                className="w-full p-2 border rounded text-sm"
                value={form.username ?? ''}
                onChange={e => setForm({ ...form, username: e.target.value })}
                placeholder="ex: prenume.nume"
              />
            </label>
            <label className="block mb-2 text-sm">
              Telefon
              <input
                className="w-full p-2 border rounded text-sm"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
              />
            </label>
            <label className="block mb-2 text-sm">
              Email
              <input
                className="w-full p-2 border rounded text-sm"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label className="block mb-2 text-sm">
              Rol
              <select
                className="w-full p-2 border rounded text-sm"
                value={form.role}
                onChange={e => setForm({ ...form, role: e.target.value })}
              >
                <option value="driver">Driver</option>
                <option value="agent">Agent</option>
                <option value="operator_admin">Operator admin</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label className="block mb-2 text-sm flex items-center">
              <input
                type="checkbox"
                className="mr-2"
                checked={Boolean(form.active)}
                onChange={e => setForm({ ...form, active: e.target.checked })}
              />
              Activ
            </label>
            <label className="block mb-4 text-sm">
              Operator
              <select
                className="w-full p-2 border rounded text-sm"
                value={form.operator_id ?? ''}
                onChange={e =>
                  setForm({
                    ...form,
                    operator_id: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">Fără operator specific</option>
                {operators.map(op => (
                  <option key={op.id} value={op.id}>
                    {op.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="text-right space-x-2">
              <button
                onClick={closeModal}
                className="px-3 py-1 bg-gray-300 rounded text-sm"
              >
                Anulează
              </button>
              <button
                onClick={save}
                className="px-3 py-1 bg-green-600 text-white rounded text-sm"
              >
                Salvează
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="mt-10 max-w-xl">
        <h3 className="text-lg font-semibold mb-2">Invitații rapide</h3>
        <p className="text-sm text-gray-600 mb-4">
          Trimite un link de înscriere unui viitor coleg. Invitația expiră automat după perioada aleasă.
        </p>

        <form onSubmit={createInvitation} className="space-y-4 bg-gray-50 border border-gray-200 rounded p-4">
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="invite-email">
              Email destinatar
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={inviteForm.email}
              onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="nume@exemplu.ro"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              Rol acordat
              <select
                className="mt-1 w-full border rounded px-3 py-2 text-sm"
                value={inviteForm.role}
                onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}
              >
                <option value="agent">Agent</option>
                <option value="driver">Șofer</option>
                <option value="operator_admin">Operator admin</option>
                <option value="admin">Admin</option>
              </select>
            </label>

            <label className="block text-sm font-medium">
              Valabilitate (ore)
              <input
                type="number"
                min="1"
                className="mt-1 w-full border rounded px-3 py-2 text-sm"
                value={inviteForm.ttl_hours}
                onChange={e => setInviteForm(f => ({ ...f, ttl_hours: e.target.value }))}
              />
            </label>
          </div>

          {operators.length > 0 && (
            <label className="block text-sm font-medium">
              Operator asignat
              <select
                className="mt-1 w-full border rounded px-3 py-2 text-sm"
                value={inviteForm.operator_id ?? ''}
                onChange={e => setInviteForm(f => ({ ...f, operator_id: e.target.value || null }))}
                disabled={currentRole === 'operator_admin'}
              >
                <option value="">Fără operator specific</option>
                {operators.map(op => (
                  <option key={op.id} value={op.id}>
                    {op.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {inviteError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {inviteError}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-green-600 text-white rounded disabled:opacity-60"
              disabled={creatingInvite}
            >
              {creatingInvite ? 'Se generează…' : 'Generează invitația'}
            </button>
            <span className="text-xs text-gray-500">
              Vom salva automat angajatul când folosește linkul.
            </span>
          </div>
        </form>

        {inviteLink && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded px-4 py-3 text-sm">
            <p className="font-semibold text-green-700">Invitație generată!</p>
            <p className="mt-1 text-green-700">Trimite linkul de mai jos colegului:</p>
            {inviteEmailSent ? (
              <p className="mt-2 text-xs text-green-600">
                Email trimis automat către {lastInviteEmail || 'destinatar'}.
              </p>
            ) : (
              <p className="mt-2 text-xs text-amber-600">
                Emailul automat nu a putut fi trimis. Copiază linkul manual și transmite-l colegului.
              </p>
            )}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                readOnly
                value={inviteLink}
                className="flex-1 border border-green-300 rounded px-3 py-2 bg-white text-green-900"
              />
              <button
                type="button"
                className="px-3 py-2 bg-green-600 text-white rounded"
                onClick={async () => {
                  try {
                    if (navigator?.clipboard?.writeText) {
                      await navigator.clipboard.writeText(inviteLink);
                      setCopied(true);
                    } else {
                      setCopied(false);
                    }
                  } catch (err) {
                    console.error('copy failed', err);
                    setCopied(false);
                  }
                }}
              >
                Copiază linkul
              </button>
            </div>
            {copied && <p className="mt-2 text-xs text-green-600">Link copiat în clipboard.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
