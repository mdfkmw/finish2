// File: AdminPage.jsx
import React, { useEffect, useState } from 'react';
import AdminDrivers from './AdminDrivers';
import AdminRuteTab from './AdminRuteTab';
import StationsPage from './StationsPage';
import DiscountTypeAdmin from './AdminDiscountType';
import AdminPriceLists from './AdminPriceLists';
import AdminEmployees from './AdminEmployees';
import AdminPromoCodes from './AdminPromoCodes';
import AdminDisabledSchedules from './AdminDisabledSchedules';
import AdminVehicles from "./AdminVehicles";
import UserPreferences from './UserPreferences';
import AdminFiscalSettings from './AdminFiscalSettings';

export default function AdminPage() {
  const [tab, setTab] = useState('drivers');
  const [role, setRole] = useState(null); // 'admin' | 'operator_admin' | ...
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        const data = await r.json().catch(() => ({}));
        setRole(data?.user?.role || null);
      } catch {
        setRole(null);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);


  const tabButton = (key, label) => (
    <button
      className={
        tab === key
          ? 'bg-blue-600 text-white px-3 py-1 rounded'
          : 'bg-gray-200 px-3 py-1 rounded'
      }
      onClick={() => setTab(key)}
    >
      {label}
    </button>
  );

  return (
    <div className="p-4">
      {loading && <div>Se încarcă...</div>}
      {!loading && !['admin','operator_admin','agent'].includes(role) && (
        <div className="text-red-600">Acces interzis.</div>
      )}
      {!loading && ['admin','operator_admin','agent'].includes(role) && (
        <>
          {/* --- TAB BAR ---------------------------------------------------- */}
          <div className="flex flex-wrap gap-2 mb-4">
            {tabButton('drivers', 'Șoferi')}
            {tabButton('prefs', 'Preferințe')}   {/* vizibil pentru toți */}
            {/* Agentul vede doar tab-ul de asignări; restul tab-urilor sunt ascunse pentru el */}
            {['admin','operator_admin'].includes(role) && (
              <>
                {tabButton('rute', 'Rute')}
                {tabButton('stations', 'Stații')}
                {tabButton('discounts', 'Tipuri Discount')}
                {tabButton('prices', 'Liste prețuri')}
                {tabButton('employees', 'Angajați')}
                {tabButton('disabled', 'Curse Dezactivate')}
                {tabButton('vehicles', 'Mașini')}
                {tabButton('promo', 'Coduri promo')}
                {tabButton('fiscal', 'Fiscalizare')}
              </>
            )}
          </div>

          {/* --- TAB CONTENT ------------------------------------------------ */}
          {tab === 'drivers'    && <AdminDrivers />}
          {tab === 'prefs'      && <UserPreferences />}
          {['admin','operator_admin'].includes(role) && (
            <>
              {tab === 'rute'       && <AdminRuteTab />}
              {tab === 'stations'   && <StationsPage />}
              {tab === 'discounts'  && <DiscountTypeAdmin />}
              {tab === 'prices'     && <AdminPriceLists />}
              {tab === 'employees'  && <AdminEmployees />}
              {tab === 'disabled'   && <AdminDisabledSchedules />}
              {tab === 'vehicles'   && <AdminVehicles />}
              {tab === 'promo'      && <AdminPromoCodes />}
              {tab === 'fiscal'     && <AdminFiscalSettings />}
            </>
          )}
        </>
      )}
    </div>
  );
}
