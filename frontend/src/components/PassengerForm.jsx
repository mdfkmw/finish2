import React, { useState, useEffect } from 'react';
import Select from 'react-select';
import { isPassengerValid } from './utils/validation';
import { getBestAvailableSeat } from './reservationLogic';







const PassengerForm = ({
    seat,
    selectedRoute,
    passengersData,
    setPassengersData,
    selectedSeats,
    setSelectedSeats,
    autoSelectEnabled,
    fetchPrice,
    setToastMessage,
    setToastType,
    toggleSeat,
    seats,
    selectedDate,
    selectedHour,
    selectedScheduleId,
    selectedDirection,

    onConflictInfo,
    onBlacklistInfo,
    stops = [],
    getStationIdByName,
    getStationNameById,
    stopDetailsByName = new Map(),
}) => {

    // formatăm date ISO (cu T...Z) în dd.mm.yyyy
    const fmtDate = (value) => {
        if (!value) return '';
        const s = String(value).trim();
        // dacă e deja dd.mm.yyyy -> return as-is
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;
        // dacă e yyyy-mm-dd[...]
        const iso = s.split('T')[0];
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
            const [y, m, d] = iso.split('-');
            return `${d}.${m}.${y}`;
        }
        // încearcă parse generic și formatează
        const d = new Date(s);
        if (!isNaN(d)) {
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dd}.${mm}.${yyyy}`;
        }
        return s;
    };




    // ⇩ LOG helper: încearcă să rezolve numele stației din ID și loghează
    const resolveStationName = (id, existingText, src) => {
        if (existingText) return existingText;
        if (id == null || !getStationNameById) return '';
        const n = Number(id);
        const nameNum = getStationNameById(!isNaN(n) ? n : id);
        const nameStr = nameNum || getStationNameById(String(id)) || '';
        //console.debug('[StationResolve]', src, { id, typeofId: typeof id, n, nameNum, nameStr });
        return nameStr;
    };






    // Linie în Format A (folosită peste tot)
    const lineA = (obj = {}) => {
        const rawDate = obj.date || obj.created_at || obj.reservation_time || obj.backup_time || '';
        const d = rawDate ? fmtDate(String(rawDate).trim()) : '';
        let t = '';
        if (obj.time) t = String(obj.time).slice(0, 5);
        else if (obj.hour) t = String(obj.hour).slice(0, 5);
        const seatLabel = obj.seat_label ? ` • Loc: ${obj.seat_label}` : '';
        // ⇩ Rezolvăm (cu log) numele stațiilor dacă lipsesc
        // Prioritizăm numele venite din API; abia apoi mapăm prin ruta curentă
        const boardName = obj.board_name || resolveStationName(obj.board_station_id, obj.board_at, 'lineA/board');
        const exitName = obj.exit_name || resolveStationName(obj.exit_station_id, obj.exit_at, 'lineA/exit');
        // fallback de vizualizare ca să vedem ceva util dacă tot nu se rezolvă
        const boardShown = boardName || (obj.board_station_id != null ? `#${obj.board_station_id}` : '—');
        const exitShown = exitName || (obj.exit_station_id != null ? `#${obj.exit_station_id}` : '—');
        return (
            <>
                {d ? `• ${d} • ` : '• '}
                {obj.route_name || ''}
                {t ? ` • ${t}` : ''}
                {seatLabel}
                {` • (`}<b>{boardShown}</b>{` → `}<b>{exitShown}</b>{`)`}
            </>
        );
    };



    // 🔧 Formatăm data fără T...Z (ex: 2025-10-12 devine 12.10.2025)
    const formatDate = (value) => {
        if (!value) return '';
        try {
            const d = new Date(value);
            const zi = String(d.getDate()).padStart(2, '0');
            const luna = String(d.getMonth() + 1).padStart(2, '0');
            const an = d.getFullYear();
            return `${zi}.${luna}.${an}`;
        } catch {
            return value;
        }
    };


    const passenger = passengersData[seat.id] || {};
    const { errors } = isPassengerValid(passenger);
    // ─── blacklist warning state ───
    const [blacklistInfo, setBlacklistInfo] = useState(null);
    const [showBlacklistDetails, setShowBlacklistDetails] = useState(false);
    const [personHistory, setPersonHistory] = useState(null);
    const [autoFilled, setAutoFilled] = useState(false);
    const [segmentNotice, setSegmentNotice] = useState(null);
    // ─── phone owners (current / previous) ───
    const [phoneInfo, setPhoneInfo] = useState(null);              // { phone_id, current_owner, previous_owners[] }
    const [phoneLookupLoading, setPhoneLookupLoading] = useState(false);
    // no-shows pentru deținătorii „pending” (fallback dacă backend-ul nu le atașează)
    const [pendingDetails, setPendingDetails] = useState({}); // { [personId]: { no_shows: [], count: 0 } }

    // ─── Popup "Schimbă deținătorul" ───
    const [showChangeOwnerModal, setShowChangeOwnerModal] = useState(false);
    const [changeOwnerName, setChangeOwnerName] = useState('');

    const stopList = Array.isArray(stops) ? stops : [];
    const stopMetaMap = stopDetailsByName instanceof Map ? stopDetailsByName : new Map();
    const defaultBoard = stopList[0] || null;
    const defaultExit = stopList.length > 0 ? stopList[stopList.length - 1] : null;
    const currentBoardLabel = passenger.board_at || defaultBoard;
    const currentExitLabel = passenger.exit_at || defaultExit;
    const boardInfo = currentBoardLabel ? stopMetaMap.get(currentBoardLabel) || null : null;
    const exitInfo = currentExitLabel ? stopMetaMap.get(currentExitLabel) || null : null;
    const boardDetailsParts = [];
    if (boardInfo?.time) boardDetailsParts.push(`Ora: ${boardInfo.time}`);
    if (boardInfo?.note) boardDetailsParts.push(boardInfo.note);

    const exitDetailsParts = [];
    if (exitInfo?.time) exitDetailsParts.push(`Ora: ${exitInfo.time}`);
    if (exitInfo?.note) exitDetailsParts.push(exitInfo.note);

    const hasStopDetails = boardDetailsParts.length > 0 || exitDetailsParts.length > 0;

 const updateSegmentForSeat = (prevState, rawBoard, rawExit, options = {}) => {
     /*  ➟  opţiune nouă:
         skipOrderCheck = true => NU mai verificăm ordinea urcare-coborâre
         (o folosim când completăm automat segmentul din istoricul clientului) */
     const { skipOrderCheck = false } = options;
        if (!stopList.length) return prevState;

        const prevData = prevState[seat.id] || {};
        const isEdit = !!prevData.reservation_id;

        let nextBoard = stopList.includes(rawBoard) ? rawBoard : defaultBoard;
        let nextExit = stopList.includes(rawExit) ? rawExit : defaultExit;

        if (!nextBoard) nextBoard = defaultBoard;
        if (!nextExit) nextExit = defaultExit;

        const boardIndex = stopList.indexOf(nextBoard);
        const exitIndex = stopList.indexOf(nextExit);
        // ⚙️ Permitem orice segment valid în ordine corectă, fără reset la capete
        if (boardIndex === -1 || exitIndex === -1) {
            // Dacă una dintre stații nu există în listă → revenim la valorile curente
            return prevState;
        }
        /*  în mod normal păstrăm regula “urcare înainte de coborâre”,
            DAR dacă venim din auto-complete (skipOrderCheck) acceptăm şi
            ordine inversă – pentru cazurile când ruta este pe sensul retur */
        if (!skipOrderCheck && boardIndex >= exitIndex) {
            alert('Stația de coborâre trebuie să fie după cea de urcare!');
            return prevState;
        }


        const updatedData = { ...prevData, board_at: nextBoard, exit_at: nextExit };

        if (isEdit || !autoSelectEnabled) {
            if (prevData.board_at === nextBoard && prevData.exit_at === nextExit) {
                return prevState;
            }
            fetchPrice(seat.id, nextBoard, nextExit);
            return {
                ...prevState,
                [seat.id]: updatedData,
            };
        }

        const otherIds = Object.keys(prevState)
            .map((key) => Number(key))
            .filter((id) => id !== seat.id);

        const filteredSeats = seats.filter((s) => !otherIds.includes(s.id));

        const candidate = getBestAvailableSeat(
            filteredSeats,
            nextBoard,
            nextExit,
            stopList,
            otherIds,
        );

        if (!candidate) {
            setToastMessage('Nu există loc disponibil pentru segmentul selectat.');
            setToastType('error');
            setTimeout(() => setToastMessage(''), 3000);
            return prevState;
        }

        if (candidate.id === seat.id) {
            if (prevData.board_at === nextBoard && prevData.exit_at === nextExit) {
                return prevState;
            }
            fetchPrice(candidate.id, nextBoard, nextExit);
            return {
                ...prevState,
                [candidate.id]: updatedData,
            };
        }

        fetchPrice(candidate.id, nextBoard, nextExit);
        setSelectedSeats((list) =>
            list.map((s) => (s.id === seat.id ? candidate : s)),
        );

        const updatedState = { ...prevState };
        delete updatedState[seat.id];
        updatedState[candidate.id] = updatedData;
        return updatedState;
    };

    // ——— Schimbă deținătorul numărului la pasagerul curent (rutele /api/people) ———
    async function setAsCurrentOwner() {
        try {
            const raw = String(passenger.phone || '');
            const digits = raw.replace(/\D/g, '');
            if (digits.length < 10) return alert('Telefon invalid');

            let pid = passenger.person_id;
            if (!pid) {
                // creăm rapid persoana (pending), apoi o setăm activă
                const createRes = await fetch('/api/people', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: passenger.name || '', phone: digits })
                });
                const createData = await createRes.json();
                if (!createRes.ok || !createData?.id) {
                    return alert(createData?.error || 'Eroare la crearea persoanei');
                }
                pid = createData.id;
                // ținem și în state noul person_id
                setPassengersData(prev => ({
                    ...prev,
                    [seat.id]: { ...prev[seat.id], person_id: pid }
                }));
            }
            if (!window.confirm('Confirmi schimbarea deținătorului pentru acest număr?')) return;

            const res = await fetch('/api/people/owner/set-active', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    person_id: pid,
                    phone: digits,
                    agent_id: 1
                })
            });
            const data = await res.json();
            if (!res.ok || !data?.success) {
                return alert(data?.error || 'Eroare la schimbarea deținătorului');
            }
            // reîmprospătăm informațiile și închidem popup-ul
            try {
                const chk = await fetch(`/api/blacklist/check?phone=${digits}`).then(r => r.json());
                setBlacklistInfo(chk);
            } catch { }
            try {
                const info = await fetch(`/api/people/owner/status?phone=${digits}`).then(r => r.json());
                setPhoneInfo(info);
            } catch { }
            setShowBlacklistDetails(false);
            setShowConflictDetails(false);
            alert('Deținător actualizat.');
        } catch {
            alert('Eroare la schimbarea deținătorului');
        }
    }







    // starea pentru conflict
    const [conflictInfo, setConflictInfo] = useState([]);
    const [showConflictDetails, setShowConflictDetails] = useState(false);
    const [hasConflict, setHasConflict] = useState(false);
    useEffect(() => {

        const date = selectedDate;
        const time = selectedHour;
        const board = passenger.board_at;
        const exit = passenger.exit_at;

        if (!date || !time || !board || !exit) {
            setHasConflict(false);
            setConflictInfo(null);
            return;
        }

        const boardId = getStationIdByName ? getStationIdByName(board) : null;
        const exitId = getStationIdByName ? getStationIdByName(exit) : null;
        if (boardId === null || exitId === null) {
            setHasConflict(false);
            setConflictInfo([]);
            onConflictInfo([]);
            return;
        }
        if (!passenger.person_id) return; // așteaptă până avem person_id din blacklist/check
        const params = new URLSearchParams({
            date,
            board_station_id: boardId,
            exit_station_id: exitId,
            person_id: String(passenger.person_id)
        });

        if (selectedScheduleId) {
            params.set('route_schedule_id', String(selectedScheduleId));
        } else if (time) {
            params.set('time', time);
        }

        if (selectedDirection) {
            params.set('direction', selectedDirection);
        }


        fetch(`/api/reservations/conflict?${params.toString()}`)
            .then(r => r.json())
            .then(data => {
                if (data.conflict) {
                    setHasConflict(true);
                    const enriched = (data.infos || []).map(info => ({
                        ...info,
                        board_at: getStationNameById ? getStationNameById(info.board_station_id) : '',
                        exit_at: getStationNameById ? getStationNameById(info.exit_station_id) : ''
                    }));
                    setConflictInfo(enriched);
                    onConflictInfo(data.infos);
                } else {
                    setHasConflict(false);
                    setConflictInfo([]);      // golim array-ul
                    onConflictInfo([]);       // anunţăm parent-ul
                }
            })
            .catch(() => {
                setHasConflict(false);
                setConflictInfo([]);
                onConflictInfo([]);
            });
    }, [

        passenger.person_id,
        passenger.board_at,
        passenger.exit_at,
        selectedDate,
        selectedHour,
        selectedScheduleId,
        selectedDirection,
        getStationIdByName,
        getStationNameById
    ]);
    ;
    ;




    useEffect(() => {
        const raw = passenger.phone || '';
        const digits = raw.replace(/\D/g, '');

        setPersonHistory(null);
        setAutoFilled(false);

        if (!digits) {
            const prevData = passengersData[seat.id] || {};
            const isEdit = !!prevData.reservation_id;
            const hasName = (prevData.name || '').trim().length > 0;
            if (!isEdit && !hasName) {
                setPassengersData(prev => ({
                    ...prev,
                    [seat.id]: { ...prev[seat.id], name: '' }
                }));
            }
            return;
        }

        if (digits.length < 10) return;



        // Altfel, facem fetch pentru istoric și eventual autofill
        fetch(`/api/people/history?phone=${encodeURIComponent(digits)}`)
            .then(res => res.json())
            .then(data => {
                if (data.exists) {
                    const historyWithNames = Array.isArray(data.history)
                        ? data.history.map(item => ({
                            ...item,
                            // preferă numele din API; altfel mapează din ruta curentă
                            board_at: item.board_name || resolveStationName(item.board_station_id, item.board_at, 'people/history board'),
                            exit_at: item.exit_name || resolveStationName(item.exit_station_id, item.exit_at, 'people/history exit')
                        }))
                        : [];
                    setPersonHistory({ ...data, history: historyWithNames });
                    if (!autoFilled && data.name) {
                        // auto-fill doar dacă nu există deja un name tastat
                        if (!passenger.name) {
                            setPassengersData(prev => ({
                                ...prev,
                                [seat.id]: {
                                    ...prev[seat.id],
                                    name: data.name
                                }
                            }));
                        }
                        setAutoFilled(true);
                    }
                } else {
                    setPersonHistory(null);
                    setAutoFilled(false);
                }
            })
            .catch(() => {
                setPersonHistory(null);
                setAutoFilled(false);
            });
    }, [passenger.phone, getStationNameById]);

    // ─── Segment implicit / preferat per client ───
    // ─── Segment implicit / preferat per client ───
    useEffect(() => {
        // normalizăm telefonul o singură dată, la începutul efectului
        const rawPhone = passenger.phone || '';
        const digits = rawPhone.replace(/\D/g, '');

        // dacă nu avem lista de stații sau capetele rutei, ieșim fără să atingem segmentul
        if (!stopList?.length || !defaultBoard || !defaultExit || !selectedRoute?.id) {
            setSegmentNotice(null);
            return;
        }

        // fără telefon -> lăsăm selecția manuală în pace (NU resetăm)
        if (digits.length === 0) {
            setSegmentNotice(null);
            return;
        }

        // telefon incomplet -> așteptăm, nu facem nimic
        if (digits.length < 10) {
            return;
        }

        const prevData = passenger;

        // dacă segmentul a fost deja aplicat pentru ACEST telefon, nu rescriem
        if (prevData.board_at && prevData.exit_at && prevData.segmentAutoAppliedPhone === digits) {
            // console.log('🔸 Segment deja aplicat pentru acest telefon — nu îl rescriem.');
            return;
        }

        // dacă există flag pentru ALT telefon, curățăm ca să permitem re-aplicarea pentru noul număr
        if (prevData.segmentAutoAppliedPhone && prevData.segmentAutoAppliedPhone !== digits) {
            setPassengersData(prev => ({
                ...prev,
                [seat.id]: { ...(prev[seat.id] || {}), segmentAutoAppliedPhone: null }
            }));
        }

        // dacă edităm o rezervare existentă, nu suprascriem segmentul
        const isEdit = !!prevData.reservation_id;
        if (isEdit) {
            setSegmentNotice(null);
            return;
        }

        let cancelled = false;

        fetch(`/api/traveler-defaults?phone=${encodeURIComponent(digits)}&route_id=${selectedRoute.id}&direction=${selectedDirection}`)
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(data => {
                if (cancelled) return;

                // dacă nu există preferințe în DB → NU resetăm; lăsăm ce a ales agentul
                if (!data?.found) {
                    // Telefon nou fără istoric: setăm o singură dată capetele rutei (A→Z),
                    // dar NU afișăm mesajul „istoric client”
                    setSegmentNotice(null);

                    setPassengersData(prev => {
                        const updated = updateSegmentForSeat(prev, defaultBoard, defaultExit);
                        // marcăm că am aplicat pentru acest număr ca să nu re-aplicăm în buclă
                        updated[seat.id] = { ...(updated[seat.id] || {}), segmentAutoAppliedPhone: digits };
                        return updated;
                    });

                    return;
                }



                const boardName =
                    data.board_name ??
                    (data.board_station_id != null ? getStationNameById?.(data.board_station_id) : null);

                const exitName =
                    data.exit_name ??
                    (data.exit_station_id != null ? getStationNameById?.(data.exit_station_id) : null);

                // dacă din orice motiv nu putem valida stațiile din snapshot-ul rutei → nu atingem segmentul
                if (!boardName || !exitName || !stopList.includes(boardName) || !stopList.includes(exitName)) {
                    setSegmentNotice(null);
                    return;
                }

                const prevBoard = prevData.board_at || defaultBoard;
                const prevExit = prevData.exit_at || defaultExit;
                const changed = (boardName !== prevBoard) || (exitName !== prevExit);

                if (changed) {
                    setSegmentNotice({ type: 'history', board: boardName, exit: exitName, phone: digits });
                } else if (segmentNotice?.type === 'history' && segmentNotice.phone !== digits) {
                    setSegmentNotice(null);
                }

                // aplicăm o singură dată pentru telefonul curent și marcăm cu numărul pentru care s-a aplicat
                setPassengersData(prev => {
                    const updated = updateSegmentForSeat(
                        prev,
                        boardName,
                        exitName,
                        { skipOrderCheck: true }   //  ✅ aici!
                    );
                    updated[seat.id] = { ...(updated[seat.id] || {}), segmentAutoAppliedPhone: digits };
                    return updated;
                });
            })
            .catch(() => {
                if (cancelled) return;
                setSegmentNotice(null);
            });

        return () => {
            cancelled = true;
        };
    }, [
        passenger.phone,
        selectedRoute?.id,
        seat.id,
        stopList,          // asigură-te că acesta e array-ul tău de stații afisate în UI
        defaultBoard,
        defaultExit,
        getStationNameById,
        setPassengersData,
        updateSegmentForSeat,
        segmentNotice,
        passenger.board_at,
        passenger.exit_at,
        passenger.segmentAutoAppliedPhone,
    ]);
    ;
    ;


    // ─── lookup deținător tel curent + „a aparținut” (rutele /api/people) ───
    useEffect(() => {
        const raw = passenger.phone || '';
        const digits = raw.replace(/\D/g, '');
        setPhoneInfo(null);
        if (digits.length < 10) return;
        setPhoneLookupLoading(true);
        fetch(`/api/people/owner/status?phone=${encodeURIComponent(digits)}`)
            .then(r => r.json())
            .then(data => {
                // mapăm stațiile la nume pentru fiecare pending.no_shows
                const pending = Array.isArray(data?.pending)
                    ? data.pending.map(p => ({
                        ...p,
                        no_shows: Array.isArray(p.no_shows)
                            ? p.no_shows.map(ns => {
                                const seat = Array.isArray(seats) ? seats.find(s => s.id === ns.seat_id) : null;
                                return {
                                    ...ns,
                                    hour: ns.hour,
                                    seat_label: ns.seat_label || seat?.label || null,
                                    board_at: resolveStationName(ns.board_station_id, ns.board_at, 'owner/status board'),
                                    exit_at: resolveStationName(ns.exit_station_id, ns.exit_at, 'owner/status exit')
                                };
                            })
                            : p.no_shows
                    }))
                    : [];
                setPhoneInfo({ ...data, pending });
            })
            .catch(() => setPhoneInfo(null))
            .finally(() => setPhoneLookupLoading(false));
    }, [passenger.phone]);


    // când avem pending și lipsesc no_shows, încercăm să le încărcăm din /api/people/:id/report
    useEffect(() => {
        const pend = Array.isArray(phoneInfo?.pending) ? phoneInfo.pending : [];
        if (pend.length === 0) return;
        let cancelled = false;
        (async () => {
            const updates = {};
            for (const p of pend) {
                const pid = Number(p.id);
                if (!pid) continue;
                const already = pendingDetails[pid];
                const hasFromBackend = Array.isArray(p.no_shows);
                if (hasFromBackend && !already) {
                    const mapped = p.no_shows.slice(0, 5).map(ns => {
                        const seat = Array.isArray(seats) ? seats.find(s => s.id === ns.seat_id) : null;
                        return {
                            ...ns,
                            hour: ns.hour,
                            seat_label: ns.seat_label || seat?.label || null,
                            board_at: getStationNameById ? getStationNameById(Number(ns.board_station_id)) : '',
                            exit_at: getStationNameById ? getStationNameById(Number(ns.exit_station_id)) : ''
                        };
                    });
                    updates[pid] = { no_shows: mapped, count: Number(p.no_shows_count || p.noShows?.length || 0) };
                    continue;
                }
                if (already || hasFromBackend) continue;
                try {
                    const rep = await fetch(`/api/people/${pid}/report`).then(r => r.json());
                    const list = Array.isArray(rep?.no_shows) ? rep.no_shows :
                        (Array.isArray(rep?.noShows) ? rep.noShows : []);
                    const mapped = list.slice(0, 5).map(ns => {
                        const seat = Array.isArray(seats) ? seats.find(s => s.id === ns.seat_id) : null;
                        return {
                            ...ns,
                            hour: ns.hour,
                            seat_label: ns.seat_label || seat?.label || null,
                            board_at: getStationNameById ? getStationNameById(Number(ns.board_station_id)) : '',
                            exit_at: getStationNameById ? getStationNameById(Number(ns.exit_station_id)) : ''
                        };
                    });
                    updates[pid] = { no_shows: mapped, count: list.length };
                } catch { }
            }
            if (!cancelled && Object.keys(updates).length > 0) {
                setPendingDetails(prev => ({ ...prev, ...updates }));
            }
        })();
        return () => { cancelled = true; };
    }, [phoneInfo?.pending]);



    useEffect(() => {
        const rawPhone = passenger.phone || '';
        const digits = rawPhone.replace(/\D/g, '');

        // < 10 cifre → curățăm + nu facem request
        if (digits.length < 10) {
            setBlacklistInfo({
                phone: rawPhone,
                blacklisted: false,
                reason: null,
                no_shows: [],
                created_at: null
            });
            setPassengersData(prev => ({
                ...prev,
                [seat.id]: { ...prev[seat.id], person_id: null }
            }));
            return;
        }

        fetch(`/api/blacklist/check?phone=${encodeURIComponent(digits)}`)
            .then(res => res.json())
            .then(data => {
                // NU mai suprascriem passenger.person_id aici;
                // îl setăm doar când salvăm sau când creăm persoană nouă pentru set-active.
                // compune info pentru UI (numele stațiilor din ID)
                const noShows = Array.isArray(data.no_shows)
                    ? data.no_shows.map(item => {
                        const seat = Array.isArray(seats) ? seats.find(s => s.id === item.seat_id) : null;
                        return {
                            ...item,
                            // păstrăm hour dacă vine din backend
                            hour: item.hour,
                            // eticheta locului (dacă o putem deduce din seat_id)
                            seat_label: item.seat_label || seat?.label || null,
                            // preferă numele din API; dacă lipsesc, mapează prin ruta curentă
                            board_at: item.board_name || resolveStationName(item.board_station_id, item.board_at, 'blacklist/check board'),
                            exit_at: item.exit_name || resolveStationName(item.exit_station_id, item.exit_at, 'blacklist/check exit')
                        };
                    })
                    : [];

                const history = Array.isArray(data.blacklist_history) ? data.blacklist_history : [];
                const lastEntry = history[history.length - 1] || {};

                const enriched = {
                    phone: rawPhone,
                    blacklisted: data.blacklisted,
                    reason: data.reason,
                    no_shows: noShows,
                    created_at: lastEntry.created_at || null
                };

                setBlacklistInfo(enriched);
                // ✅ ADĂUGAT: dacă API-ul a găsit owner ACTIV, punem person_id în state
                if (data && data.person_id) {
                    setPassengersData(prev => ({
                        ...prev,
                        [seat.id]: { ...(prev[seat.id] || {}), person_id: data.person_id }
                    }));
                }
                onBlacklistInfo?.(enriched);
            })
            .catch(() => {
                setBlacklistInfo(null);
                onBlacklistInfo?.(null);
            });
    }, [passenger.phone, getStationNameById]);

    // ─── Derivate pentru iconițe (activ) ───
    const isBlacklisted =
        !!(blacklistInfo?.blacklisted ?? blacklistInfo?.is_blacklisted);
    const directNoShows = Array.isArray(blacklistInfo?.no_shows)
        ? blacklistInfo.no_shows.length
        : (Array.isArray(blacklistInfo?.noShows) ? blacklistInfo.noShows.length : 0);
    const reportedNoShows = Number(blacklistInfo?.no_shows_count ?? blacklistInfo?.noShowsCount ?? 0);
    const noShowCount = Math.max(directNoShows, reportedNoShows);

    // ─── Adăugăm semnale și din deținătorii "pending" (suspecți) ───
    const pendingListRaw = Array.isArray(phoneInfo?.pending) ? phoneInfo.pending : [];
    const fallbackPendingHasBlacklist = Boolean(
        blacklistInfo?.pendingHasBlacklist ?? blacklistInfo?.pending_has_blacklist ?? false
    );
    const fallbackPendingNoShows = Number(
        blacklistInfo?.pendingNoShowsCount ?? blacklistInfo?.pending_no_shows_count ?? 0
    );
    const pendingList = pendingListRaw;
    const pendingHasBlacklist = pendingList.length > 0
        ? pendingList.some(p => Number(p.blacklist) === 1)
        : fallbackPendingHasBlacklist;
    const pendingNoShowsCount = pendingList.length > 0
        ? pendingList.reduce((sum, p) => {
            const pid = Number(p.id);
            const fallback = pendingDetails[pid]?.count || 0;
            return sum + Number(p.no_shows_count || fallback || 0);
        }, 0)
        : fallbackPendingNoShows;

    // ce arătăm ca iconițe:
    //  • 🛑 (dot roșu) dacă există blacklist la ACTIV sau la oricare PENDING
    //  • ❗ dacă există neprezentări la ACTIV sau la PENDING (și nu e blacklist)
    const showBlacklistDot = isBlacklisted || pendingHasBlacklist;
    const showNoShowBang = (noShowCount + pendingNoShowsCount) > 0;

    // condiții pentru afișarea butonului în popup
    const digitsPhone = String(passenger.phone || '').replace(/\D/g, '');
    const canChangeOwner = digitsPhone.length >= 10 && (
        isBlacklisted || pendingHasBlacklist || noShowCount > 0 || pendingNoShowsCount > 0
    );
    const alreadyOwner =
        !!(phoneInfo?.active?.id && passenger?.person_id) &&
        phoneInfo.active.id === passenger.person_id;


    return (
        <div className="relative border p-2 rounded bg-white shadow space-y-2">
            <button
                onClick={() => toggleSeat(seat)}
                className="absolute top-2 right-2 text-gray-400 hover:text-red-500 font-bold text-lg"
                title="Deselectează locul"
            >
                ×
            </button>



            <div className="font-medium flex items-center gap-2">
                Loc:
                <Select
                    className="min-w-[100px] w-auto"
                    value={{ value: seat.id, label: seat.label }}
                    options={(() => {
                        const allStops = Array.isArray(stops) ? stops : [];
                        const board_at = passengersData[seat.id]?.board_at;
                        const exit_at = passengersData[seat.id]?.exit_at;

                        const boardIndex = allStops.findIndex(s => s === board_at);
                        const exitIndex = allStops.findIndex(s => s === exit_at);

                        const candidates = seats
                            .filter(s => {
                                if (s.label.toLowerCase().includes('șofer') || s.id === seat.id) return false;
                                if (s.status === 'full') return false;

                                const conflicts = s.passengers?.some(p => {
                                    const pBoard = allStops.findIndex(x => x === p.board_at);
                                    const pExit = allStops.findIndex(x => x === p.exit_at);
                                    return !(exitIndex <= pBoard || boardIndex >= pExit);
                                });

                                return !conflicts;
                            })
                            .sort((a, b) => parseInt(a.label) - parseInt(b.label));

                        return candidates.map(s => ({
                            value: s.id,
                            label: s.label,
                        }));
                    })()}
                    onChange={(selectedOption) => {
                        const newSeatId = selectedOption.value;
                        const oldSeatId = seat.id;
                        if (newSeatId === oldSeatId) return;

                        const newSeat = seats.find(s => s.id === newSeatId);
                        const data = passengersData[oldSeatId];

                        setSelectedSeats((prev) =>
                            prev.map((s) => (s.id === oldSeatId ? newSeat : s))
                        );

                        setPassengersData((prev) => {
                            const updated = { ...prev };
                            delete updated[oldSeatId];
                            updated[newSeatId] = { ...data };
                            return updated;
                        });
                    }}
                />
            </div>



            {/* 🔤 Nume și 📞 Telefon */}
            <div className="flex gap-4">
                {/* ─── Câmpul Nume pasager + Istoric ─── */}
                <div className="w-full relative">
                    <input
                        type="text"
                        className={`w-full p-2 border rounded ${errors.name ? 'border-red-500' : 'border-gray-300'}`}
                        placeholder="Nume pasager"
                        value={passenger.name || ''}
                        onChange={e => {
                            // dacă modifici manual numele, resetează flag-ul de auto-fill
                            setAutoFilled(false);
                            setPassengersData(prev => ({
                                ...prev,
                                [seat.id]: { ...prev[seat.id], name: e.target.value }
                            }));
                        }}
                    />
                    {/* Refresh icon: apare doar când avem sugestie și n-am aplicat-o încă */}
                    {autoFilled && personHistory?.name && passenger.name !== personHistory.name && (
                        <button
                            type="button"
                            onClick={() => {
                                // aplică numele sugerat
                                setPassengersData(prev => ({
                                    ...prev,
                                    [seat.id]: { ...prev[seat.id], name: personHistory.name }
                                }));
                                // ascunde iconița după aplicare
                                setAutoFilled(false);
                            }}
                            className="absolute right-2 top-2 text-gray-500 hover:text-gray-700"
                            title="Preia numele din baza de date"
                        >
                            🔄
                        </button>
                    )}
                    {errors.name && <div className="text-red-600 text-xs mt-1">{errors.name}</div>}
                </div>



                {/* ─── Câmpul Telefon + Istoric/Blacklist/No-shows ─── */}
                <div className="w-full relative">
                    <input
                        inputMode="tel"
                        pattern="^\+?\d*$"
                        type="text"
                        className={`w-full p-2 border rounded ${errors.phone ? 'border-red-500' : 'border-gray-300'}`}
                        placeholder="Telefon"
                        value={passenger.phone || ''}
                        onChange={(e) =>
                            setPassengersData(prev => ({
                                ...prev,
                                [seat.id]: { ...prev[seat.id], phone: e.target.value }
                            }))
                        }
                    />
                    {errors.phone && <div className="text-red-600 text-xs mt-1">{errors.phone}</div>}


                    {/* container pentru toate iconițele, ca să le poziționăm pe orizontală */}
                    <div className="absolute top-2 right-3 flex space-x-1">




                        {/* ℹ️ ISTORIC (doar dacă NU e blacklist și NU are no-shows) */}
                        {personHistory?.exists && !showBlacklistDot && !showNoShowBang && (
                            <button
                                type="button"
                                onClick={() => {
                                    setShowBlacklistDetails(v => !v)
                                    setShowConflictDetails(false);
                                }}
                                className="text-blue-600 text-lg hover:opacity-75"
                                title="Vezi ultimele 5 rezervări"
                            >
                                ℹ️
                            </button>
                        )}

                        {/* ❗ NO-SHOWS (are neprezentări, dar NU e blacklist) */}
                        {!showBlacklistDot && showNoShowBang && (
                            <button
                                type="button"
                                onClick={() => setShowBlacklistDetails(v => !v)}
                                className="text-orange-600 text-lg hover:opacity-75"
                                title="Are neprezentări"
                            >
                                ❗
                            </button>
                        )}

                        {/* 🛑 BLACKLIST (prioritate) */}
                        {showBlacklistDot && (
                            <button
                                type="button"
                                onClick={() => {
                                    setShowBlacklistDetails(v => !v);
                                    setShowConflictDetails(false);
                                }}
                                className="text-red-600 text-lg hover:opacity-75"
                                title="Persoană în blacklist"
                            >
                                🛑
                            </button>
                        )}

                        {/* ⚠️ Triunghi galben pentru conflict */}
                        {hasConflict && (
                            <button
                                onClick={() => {
                                    setShowConflictDetails(v => !v);
                                    setShowBlacklistDetails(false);     // închidem istoric/blacklist
                                }}
                                className="inline-block text-yellow-500 text-lg hover:opacity-75 animate-pulse"
                                title="Există rezervare în aceeași zi pe același sens"
                            >
                                ⚠️
                            </button>
                        )}
                    </div>

                    {/* Popup comun pentru cele 3 situații */}
                    {hasConflict && showConflictDetails && conflictInfo.length > 0 && (
                        <>
                            {/* backdrop apăsat pentru click-outside */}
                            <div
                                className="fixed inset-0 z-40"
                                onClick={() => setShowConflictDetails(false)}
                            />
                            {/* fereastra efectivă de deasupra */}
                            <div className="absolute right-0 bottom-full mb-1 min-w-max 
         bg-white p-3 border border-gray-200 rounded-lg 
         shadow-lg z-50 text-sm whitespace-normal">
                                <div className="font-semibold mb-1">Rezervări conflictuale:</div>
                                <ul className="space-y-1">
                                    {conflictInfo.map((c, idx) => (
                                        <li key={idx} className="text-sm whitespace-nowrap">
                                            {c.route} • {c.time.slice(0, 5)} • Loc: {c.seatLabel} • {c.board_at}→{c.exit_at}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </>
                    )}

                    {showBlacklistDetails && (
                        <>
                            {/* backdrop pentru închiderea la click în afara pop-up-ului */}
                            <div
                                className="fixed inset-0 z-40"
                                onClick={() => setShowBlacklistDetails(false)}
                            />
                            {/* fereastra vizibilă deasupra */}
                            <div className="absolute right-0 bottom-full mb-1 min-w-max 
                    bg-white p-3 border border-gray-200 rounded-lg 
                    shadow-lg z-50 text-sm whitespace-normal">
                                {/* ——— Secțiunea A: Deținător curent (activ) ——— */}
                                <div className="mb-2">
                                    <div className="font-semibold text-gray-800">
                                        Deținător curent: {phoneInfo?.active?.name || <i>necunoscut</i>}
                                        {isBlacklisted ? ' (BLACKLIST)' : ''}
                                    </div>
                                    {noShowCount > 0 && (
                                        <>
                                            <div className="font-semibold mt-1 text-gray-700">Neprezentări</div>
                                            <ul className="space-y-1 whitespace-nowrap text-left">
                                                {(Array.isArray(blacklistInfo?.no_shows) ? blacklistInfo.no_shows : (blacklistInfo?.noShows || [])).map((sh, idx) => (
                                                    <li key={idx} className="text-sm">{lineA({ ...sh })}</li>
                                                ))}
                                            </ul>
                                        </>
                                    )}
                                    {/* Istoric rezervări – arată mereu dacă există, chiar dacă e blacklist și/sau are no-shows */}
                                    {(personHistory?.history?.length > 0) && (
                                        <>
                                            <div className="font-semibold mt-1">Istoric rezervări</div>
                                            <ul className="space-y-1 whitespace-nowrap text-left">
                                                {personHistory.history.map((sh, idx) => (
                                                    <li key={idx} className="text-sm">{lineA({ ...sh })}</li>
                                                ))}
                                            </ul>
                                        </>
                                    )}
                                </div>

                                {/* ——— Secțiunea B: A aparținut (pending) ——— */}
                                {Array.isArray(phoneInfo?.pending) && phoneInfo.pending.length > 0 && (
                                    <div className="mt-2">
                                        <ul className="space-y-2 whitespace-normal text-left">
                                            {phoneInfo.pending.map(p => {
                                                const pid = Number(p.id);
                                                const extra = pendingDetails[pid];
                                                const list = Array.isArray(p.no_shows) ? p.no_shows
                                                    : (extra ? extra.no_shows : []);
                                                const count = Number(p.no_shows_count || extra?.count || 0);
                                                return (
                                                    <li key={p.id} className="text-sm whitespace-normal">
                                                        <div className="font-semibold">Fost deținător: {p.name}</div>
                                                        {/* Blacklist (dacă este) */}
                                                        {Number(p.blacklist) === 1 && (
                                                            <div className="mt-1">
                                                                <div className="font-semibold text-gray-700">Blacklist</div>
                                                                <ul className="space-y-1 whitespace-nowrap text-left">
                                                                    <li className="text-sm">• Marcaj activ în blacklist</li>
                                                                </ul>
                                                            </div>
                                                        )}
                                                        {/* Neprezentări (dacă are) */}
                                                        {Array.isArray(list) && list.length > 0 && (
                                                            <div className="mt-1">
                                                                <div className="font-semibold text-gray-700">Neprezentări</div>
                                                                <ul className="space-y-1 whitespace-nowrap text-left">
                                                                    {list.slice(0, 5).map((ns, i) => (
                                                                        <li key={i} className="text-sm">{lineA({ ...ns })}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}
                                                        {/* Istoric (dacă backendul îți oferă în p.history) */}
                                                        {Array.isArray(p.history) && p.history.length > 0 && (
                                                            <div className="mt-1">
                                                                <div className="font-semibold text-gray-700">Istoric rezervări</div>
                                                                <ul className="space-y-1 whitespace-nowrap text-left">
                                                                    {p.history.slice(0, 5).map((h, i) => (
                                                                        <li key={i} className="text-sm">{lineA({ ...h })}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                        {/* Confirmă definitiv (în POPUP) */}
                                        <div className="mt-3 pt-2 border-t flex justify-end">
                                            <button
                                                type="button"
                                                className="px-2 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700"
                                                onClick={async () => {
                                                    try {
                                                        const digits = (passenger.phone || '').replace(/\D/g, '');
                                                        const r = await fetch('/api/people/owner/confirm', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ phone: digits, agent_id: 1 })
                                                        });
                                                        const data = await r.json();
                                                        if (!r.ok || !data?.success) throw new Error(data?.error || 'Eroare');
                                                        // reîncarcă ambele surse → pending dispar, iconițele se sting
                                                        const freshOwner = await fetch(`/api/people/owner/status?phone=${digits}`).then(x => x.json());
                                                        setPhoneInfo(freshOwner);
                                                        const freshBL = await fetch(`/api/blacklist/check?phone=${digits}`).then(x => x.json());
                                                        setBlacklistInfo(freshBL);
                                                        alert('Confirmare salvată.');
                                                    } catch (e) {
                                                        alert(e.message || 'Eroare la confirmare.');
                                                    }
                                                }}
                                            >
                                                Confirmă definitiv
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Acțiune: Schimbă deținătorul */}
                                {canChangeOwner && !alreadyOwner && (
                                    <div className="mt-3">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setChangeOwnerName(passenger?.name || '');
                                                setShowChangeOwnerModal(true);
                                            }}
                                            className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                                            title="Setează pasagerul curent ca deținător al numărului"
                                        >
                                            Schimbă deținătorul
                                        </button>
                                    </div>
                                )}</div>
                        </>
                    )}




                    {/* Popup: Schimbă deținătorul → cere numele nou */}
                    {showChangeOwnerModal && (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center">
                            {/* backdrop */}
                            <div
                                className="absolute inset-0 bg-black/30"
                                onClick={() => setShowChangeOwnerModal(false)}
                            />
                            {/* card */}
                            <div className="relative z-[61] w-full max-w-md bg-white rounded-xl shadow-xl border border-gray-200 p-4">
                                <div className="text-lg font-semibold mb-2">Schimbă deținătorul</div>
                                <label className="block text-sm text-gray-700 mb-1">Nume nou</label>
                                <input
                                    type="text"
                                    className="w-full p-2 border rounded border-gray-300"
                                    placeholder="Introdu numele deținătorului"
                                    value={changeOwnerName}
                                    onChange={(e) => setChangeOwnerName(e.target.value)}
                                />
                                <div className="mt-4 flex justify-end gap-2">
                                    <button
                                        type="button"
                                        className="px-3 py-2 rounded border border-gray-300"
                                        onClick={() => setShowChangeOwnerModal(false)}
                                    >
                                        Anulează
                                    </button>
                                    <button
                                        type="button"
                                        className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
                                        onClick={async () => {
                                            try {
                                                // 1) setăm numele în formular, ca să fie folosit de setAsCurrentOwner()
                                                setPassengersData(prev => ({
                                                    ...prev,
                                                    [seat.id]: { ...(prev[seat.id] || {}), name: changeOwnerName }
                                                }));
                                                // 2) rulăm logica ta existentă (creează persoană dacă lipsește, apoi set-active)
                                                await setAsCurrentOwner();
                                                // 3) închidem popup-ul doar dacă totul a mers
                                                setShowChangeOwnerModal(false);
                                            } catch (e) {
                                                // setAsCurrentOwner are deja try/catch intern; aici doar nu închidem dacă apare vreo eroare
                                            }
                                        }}
                                    >
                                        Salvează
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {/* ─── Phone owners banner ─── */}
                    {phoneLookupLoading && (
                        <div className="mt-1 text-xs text-gray-500">Verific numărul…</div>
                    )}




                </div>


            </div>
            {/* 🚏 Urcă din / Coboară la */}
            {segmentNotice?.type === 'history' && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-2">
 Segment actualizat automat (istoric client): <strong>{segmentNotice.board}</strong> →{' '}
 <strong>{segmentNotice.exit}</strong>
               </div>
            )}
            <div className="flex gap-4">
                <Select
                    className="w-full"
                    options={(() => {
                        const allStops = stops || [];
                        const exitIndex = allStops.findIndex(
                            (s) => s === passengersData[seat.id]?.exit_at
                        );

                        const validStops =
                            exitIndex > 0 ? allStops.slice(0, exitIndex) : allStops;

                        return validStops.map((stop) => ({
                            value: stop,
                            label: stop,
                        }));
                    })()}
                    placeholder="Urcă din"
                    value={
                        passengersData[seat.id]?.board_at
                            ? {
                                value: passengersData[seat.id].board_at,
                                label: passengersData[seat.id].board_at,
                            }
                            : null
                    }
                    onChange={(selectedOption) => {
                        const newBoard = selectedOption.value;
                        setSegmentNotice(null);
                        setPassengersData((prev) => {
                            const prevData = prev[seat.id] || {};
                            const exitValue = prevData.exit_at || defaultExit;
                            return updateSegmentForSeat(prev, newBoard, exitValue);
                        });
                    }}
                />
                <Select
                    className="w-full"
                    options={(() => {
                        const allStops = stops || [];
                        const boardIndex = allStops.findIndex(
                            (s) => s === passengersData[seat.id]?.board_at
                        );

                        const validStops =
                            boardIndex >= 0 ? allStops.slice(boardIndex + 1) : allStops;

                        return validStops.map((stop) => ({
                            value: stop,
                            label: stop,
                        }));
                    })()}
                    placeholder="Coboară la"
                    value={
                        passengersData[seat.id]?.exit_at
                            ? {
                                value: passengersData[seat.id].exit_at,
                                label: passengersData[seat.id].exit_at,
                            }
                            : null
                    }
                    onChange={(selectedOption) => {
                        const newExit = selectedOption.value;
                        setSegmentNotice(null);
                        setPassengersData((prev) => {
                            const prevData = prev[seat.id] || {};
                            const boardValue = prevData.board_at || defaultBoard;
                            return updateSegmentForSeat(prev, boardValue, newExit);
                        });
                    }}
                />
            </div>

            {hasStopDetails && (
                <div className="text-[11px] text-gray-700 bg-gray-50 border border-gray-200 rounded px-3 py-2 mt-2 space-y-1">
                    {boardDetailsParts.length > 0 && (
                        <div>
                            <span className="font-semibold text-gray-800">Urcare:</span>{' '}
                            {boardDetailsParts.join(', ')}
                        </div>
                    )}
                    {exitDetailsParts.length > 0 && (
                        <div>
                            <span className="font-semibold text-gray-800">Coborâre:</span>{' '}
                            {exitDetailsParts.join(', ')}
                        </div>
                    )}
                </div>
            )}















        </div>
    );
};

export default PassengerForm;
