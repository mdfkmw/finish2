import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import DiscountAppliesTab from './DiscountAppliesTab';

const AdminDiscountType = () => {
  const [discounts, setDiscounts] = useState([]);
  const [newDiscount, setNewDiscount] = useState({
    code: '',
    label: '',
    value_off: '',
    type: 'percent',
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState(null);

  // sorting state
  const [sortConfig, setSortConfig] = useState({ key: 'id', direction: 'asc' });

  const fetchDiscounts = async () => {
    const res = await axios.get('/api/discount-types');
    setDiscounts(res.data);
  };

  useEffect(() => {
    fetchDiscounts();
  }, []);

  const handleSave = async () => {
    if (!newDiscount.code || !newDiscount.label || !newDiscount.value_off) return;
    if (editingDiscount) {
      await axios.put(
        `/api/discount-types/${editingDiscount.id}`,
        newDiscount
      );
    } else {
      await axios.post('/api/discount-types', newDiscount);
    }
    setShowAddModal(false);
    setEditingDiscount(null);
    setNewDiscount({ code: '', label: '', value_off: '', type: 'percent' });
    fetchDiscounts();
  };

  const handleEdit = (discount) => {
    setEditingDiscount(discount);
    setNewDiscount({
      code: discount.code,
      label: discount.label,
      value_off: discount.value_off,
      type: discount.type,
    });
    setShowAddModal(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Sigur dorești să ștergi această reducere?')) return;
    try {
      await axios.delete(`/api/discount-types/${id}`);
      setDiscounts(discounts.filter((d) => d.id !== id));
    } catch (error) {
      const msg = error.response?.data?.message || 'Eroare la ștergere';
      console.error('Eroare la ștergere:', error);
      alert(msg);
    }
  };

  // sort handler
  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedDiscounts = useMemo(() => {
    const sortable = [...discounts];
    sortable.sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];
      // for value_off: compare as number
      if (sortConfig.key === 'value_off') {
        aVal = parseFloat(aVal);
        bVal = parseFloat(bVal);
      } else {
        if (typeof aVal === 'string') aVal = aVal.toLowerCase();
        if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      }
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sortable;
  }, [discounts, sortConfig]);

  return (
    <div className="space-y-10">
      <div className="overflow-x-auto">
      <h2 className="text-lg font-semibold mb-4">Tipuri de reduceri</h2>
      <button
        className="mb-4 px-3 py-1 text-sm bg-blue-600 text-white rounded"
        onClick={() => {
          setEditingDiscount(null);
          setNewDiscount({ code: '', label: '', value_off: '', type: 'percent' });
          setShowAddModal(true);
        }}
      >
        + Adaugă
      </button>

      <table className="w-auto text-sm table-auto border-collapse">
        <thead>
          <tr>
            <th
              onClick={() => requestSort('code')}
              className="p-1 border text-left cursor-pointer select-none bg-gray-200"
            >
              Cod {sortConfig.key === 'code' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th
              onClick={() => requestSort('label')}
              className="p-1 border text-left cursor-pointer select-none bg-gray-200"
            >
              Etichetă {sortConfig.key === 'label' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th
              onClick={() => requestSort('value_off')}
              className="p-1 border text-left cursor-pointer select-none bg-gray-200"
            >
              Reducere {sortConfig.key === 'value_off' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th className="p-1 border text-left bg-gray-200">Acțiuni</th>
          </tr>
        </thead>
        <tbody>
          {sortedDiscounts.map((d, idx) => (
            <tr key={d.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="p-1 border">{d.code}</td>
              <td className="p-1 border">{d.label}</td>
              <td className="p-1 border">
                {`${parseFloat(d.value_off) % 1 === 0 ? parseInt(d.value_off) : parseFloat(d.value_off)}${d.type === 'percent' ? '%' : ''}`}
              </td>
              <td className="p-1 border space-x-2">
                <button
                  className="px-2 py-1 text-xs bg-blue-500 text-white rounded"
                  onClick={() => handleEdit(d)}
                >
                  Editează
                </button>
                <button
                  className="px-2 py-1 text-xs bg-red-500 text-white rounded"
                  onClick={() => handleDelete(d.id)}
                >
                  Șterge
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded shadow-lg w-80">
            <h3 className="mb-4 text-lg font-semibold">
              {editingDiscount ? 'Editează Reducere' : 'Adaugă Reducere'}
            </h3>
            <input
              type="text"
              placeholder="Cod"
              className="w-full mb-2 px-2 py-1 border rounded text-sm"
              value={newDiscount.code}
              onChange={(e) => setNewDiscount({ ...newDiscount, code: e.target.value })}
            />
            <input
              type="text"
              placeholder="Etichetă"
              className="w-full mb-2 px-2 py-1 border rounded text-sm"
              value={newDiscount.label}
              onChange={(e) => setNewDiscount({ ...newDiscount, label: e.target.value })}
            />
            <input
              type="number"
              placeholder="Reducere"
              className="w-full mb-2 px-2 py-1 border rounded text-sm"
              value={newDiscount.value_off}
              onChange={(e) => setNewDiscount({ ...newDiscount, value_off: e.target.value })}
            />
            <div className="mb-2 text-sm">
              <label className="mr-4">
                <input
                  type="radio"
                  value="percent"
                  checked={newDiscount.type === 'percent'}
                  onChange={() => setNewDiscount({ ...newDiscount, type: 'percent' })}
                  className="mr-1"
                />
                Procent
              </label>
              <label>
                <input
                  type="radio"
                  value="fixed"
                  checked={newDiscount.type === 'fixed'}
                  onChange={() => setNewDiscount({ ...newDiscount, type: 'fixed' })}
                  className="mr-1"
                />
                Valoare fixă
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1 bg-gray-300 rounded text-sm"
                onClick={() => {
                  setShowAddModal(false);
                  setEditingDiscount(null);
                }}
              >
                Anulează
              </button>
              <button
                className="px-3 py-1 bg-green-600 text-white rounded text-sm"
                onClick={handleSave}
              >
                Salvează
              </button>
            </div>
          </div>
        </div>
      )}
      </div>

      <DiscountAppliesTab />
    </div>
  );
};

export default AdminDiscountType;
