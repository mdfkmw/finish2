// src/components/reservationLogic.js
// Autoselecție avansată + LOGURI DEBUG
// - Prioritate „lipire de segment” (adjacency) pentru 1/2/3/4+ locuri
// - Front→back doar ca tie-breaker când nu există adjacency
// - Ghid se ocupă ultimul

const DEBUG = true;
const log = (...args) => { if (DEBUG) console.debug('[autoSelect]', ...args); };

const norm = (v) => (v ?? '').toString().trim().toLowerCase();

function isSeatGuide(seat) {
  const label = String(seat?.label || '');
  const type  = String(seat?.seat_type || '');
  return /ghid/i.test(label) || /ghid|guide/i.test(type);
}
function isSeatDriver(seat) {
  const label = String(seat?.label || '');
  return /șofer|sofer/i.test(label) || String(seat?.seat_type||'') === 'driver';
}
function labelNumber(value) {
  const m = String(value ?? '').match(/\d+/);
  if (!m) return Number.POSITIVE_INFINITY;
  const n = parseInt(m[0], 10);
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
}
function seatOrderKey(seat) {
  const col = Number.isFinite(seat?.seat_col) ? seat.seat_col : Number.POSITIVE_INFINITY;
  return `${String(seat?.row ?? 9999).padStart(3,'0')}:${String(col).padStart(3, '0')}:${String(labelNumber(seat?.label)).padStart(6, '0')}`;
}

function indexOfStop(stops, name) {
  return stops.findIndex((s) => norm(s) === norm(name));
}

function isSeatFreeForSegment(seat, b, e, stops) {
  const arr = Array.isArray(seat?.passengers) ? seat.passengers : [];
  for (const p of arr) {
    if ((p?.status || 'active') !== 'active') continue;
    const pb = indexOfStop(stops, p.board_at);
    const pe = indexOfStop(stops, p.exit_at);
    if (pb === -1 || pe === -1 || pb >= pe) continue;
    const overlap = !(e <= pb || b >= pe);
    if (overlap) return false;
  }
  return true;
}
export function isSeatAvailableForSegment(seat, board_at, exit_at, stops) {
  const b = indexOfStop(stops, board_at);
  const e = indexOfStop(stops, exit_at);
  if (b === -1 || e === -1 || b >= e) return false;
  return isSeatFreeForSegment(seat, b, e, stops);
}
function isSeatPartial(seat) {
  const hasPassengers = Array.isArray(seat?.passengers) && seat.passengers.length > 0;
  return hasPassengers || String(seat?.status || '') === 'partial';
}

/* ---------- Adjacency scoring ---------- */
// +10 pentru lipire perfectă: cineva urcă fix la exit_at-ul nostru (pb===e) sau coboară fix la board_at (pe===b)
// +3 dacă locul e parțial; +0.x bonus mic pentru față (tie-breaker)
function adjacencyScoreSingle(seat, b, e, stops) {
  let score = 0;
  const arr = Array.isArray(seat?.passengers) ? seat.passengers : [];
  for (const p of arr) {
    const pb = indexOfStop(stops, p.board_at);
    const pe = indexOfStop(stops, p.exit_at);
    if (pb === e) score += 10;   // lipește după noi
    if (pe === b) score += 10;   // lipește înainte de noi
  }
  if (arr.length > 0 || String(seat?.status||'') === 'partial') score += 3;
  // front bonus (foarte mic)
  score += 1 - (labelNumber(seat?.label) / 1000);
  return score;
}
function adjacencyScoreSet(seats, b, e, stops) {
  return seats.reduce((s, x) => s + adjacencyScoreSingle(x, b, e, stops), 0);
}
function samePair(a,b){ return Number.isFinite(a?.pair_id) && Number.isFinite(b?.pair_id) && a.pair_id===b.pair_id && a.id!==b.id; }

/* ---------- Build rows ---------- */
function buildFreeSeats(seats, board_at, exit_at, stops) {
  const b = indexOfStop(stops, board_at);
  const e = indexOfStop(stops, exit_at);
  if (b === -1 || e === -1 || b >= e) {
    log('Segment invalid', { board_at, exit_at, stops });
    return { b: -1, e: -1, rows: new Map(), guides: [] };
  }

  const usable = [];
  const guides = [];
  for (const seat of seats || []) {
    if (!seat) continue;
    if (isSeatDriver(seat)) continue;
    if (!isSeatFreeForSegment(seat, b, e, stops)) continue;
    if (isSeatGuide(seat)) guides.push(seat);
    else usable.push(seat);
  }

  const rows = new Map();
  for (const s of usable) {
    const r = Number.isFinite(s?.row) ? s.row : 9999;
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push(s);
  }
  const rowKeys = [...rows.keys()].sort((a, b2) => a - b2);
  for (const r of rowKeys) rows.get(r).sort((a,b2)=>seatOrderKey(a).localeCompare(seatOrderKey(b2)));

  log('Free seats built', {
    board_at, exit_at, indexB: b, indexE: e,
    rows: rowKeys.map(r=>({ row:r, seats:(rows.get(r)||[]).map(s=>s.label) })),
    guides: guides.map(g=>g.label)
  });

  return { b, e, rows, guides };
}

/* ---------- Helpers ---------- */
function flattenRows(rows) {
  const out = [];
  for (const arr of rows.values()) out.push(...arr);
  return out;
}
function findContiguousRun(sortedSeats, needed) {
  if ((sortedSeats?.length || 0) < needed) return null;
  const cols = sortedSeats.map((s) => (Number.isFinite(s?.seat_col) ? s.seat_col : null));
  for (let i = 0; i <= cols.length - needed; i += 1) {
    if (cols[i] == null) continue;
    let ok = true;
    for (let k = 1; k < needed; k += 1) {
      if (cols[i + k] == null || cols[i + k] !== cols[i] + k) { ok = false; break; }
    }
    if (ok) return sortedSeats.slice(i, i + needed);
  }
  return null;
}

/* ---------- Singles (1 loc) ---------- */
function pickSingle(rows, b, e, stops) {
  const all = flattenRows(rows);
  if (!all.length) return [];
  const scored = all
    .map(seat => ({ seat, score: adjacencyScoreSingle(seat, b, e, stops) }))
    .sort((A, B) => {
      if (B.score !== A.score) return B.score - A.score;               // adjacency first
      return seatOrderKey(A.seat).localeCompare(seatOrderKey(B.seat)); // then front→back
    });
  const chosen = scored[0]?.seat;
  if (chosen) { log('pickSingle (adjacency-aware)', chosen.label, 'score=', scored[0].score); return [chosen]; }
  log('pickSingle → none'); 
  return [];
}

/* ---------- Pairs (2 locuri) ---------- */
// Returnează cea mai bună PERECHE (contiguă) după adjacency; la egalitate, față→spate.
function bestPair(rows, b, e, stops, used = new Set()) {
  const candidates = [];
  for (const [rk, rowArr] of rows.entries()) {
    for (let i=0;i<rowArr.length-1;i+=1) {
      const a=rowArr[i], d=rowArr[i+1];
      if (used.has(a.id) || used.has(d.id)) continue;
      if (!Number.isFinite(a?.seat_col) || !Number.isFinite(d?.seat_col)) continue;
      if (d.seat_col !== a.seat_col + 1) continue;
      const score = adjacencyScoreSet([a,d], b, e, stops) + (samePair(a,d) ? 2 : 0);
      candidates.push({ seats:[a,d], row: rk, score });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((A,B)=>{
    if (B.score !== A.score) return B.score - A.score;                // adjacency priority
    return seatOrderKey(A.seats[0]).localeCompare(seatOrderKey(B.seats[0])); // then front→back
  });
  const winner = candidates[0];
  log('bestPair', winner?.seats.map(s=>s.label), 'score=', winner?.score);
  return winner;
}

/* ---------- Triples (3 locuri) ---------- */
// Strategie: (1) pereche + single (cu scor maxim, ideal același rând) ; (2) bloc 3; (3) 3 single-uri
function bestTriple(rows, b, e, stops) {
  const used = new Set();
  const pair = bestPair(rows, b, e, stops, used);
  let best = null;

  if (pair) {
    used.add(pair.seats[0].id); used.add(pair.seats[1].id);
    // candidate singles (prefer same row, dar adjacency decide)
    const singles = [];
    for (const [rk, rowArr] of rows.entries()) {
      for (const s of rowArr) {
        if (used.has(s.id)) continue;
        singles.push({ seat:s, row: rk, score: adjacencyScoreSingle(s, b, e, stops) });
      }
    }
    singles.sort((A,B)=>{
      if (B.score !== A.score) return B.score - A.score;               // adjacency priority
      // prefer same row ca tie-breaker
      if ((A.row===pair.row) !== (B.row===pair.row)) return (B.row===pair.row) - (A.row===pair.row);
      return seatOrderKey(A.seat).localeCompare(seatOrderKey(B.seat));
    });
    if (singles.length) {
      let bonus = 0.5; // preferăm această combinație față de blocuri din spate
      if (singles[0].row === pair.row) bonus = 2; // același rând → bonus mare chiar dacă există culoar
      const cand = { seats:[...pair.seats, singles[0].seat], score: pair.score + singles[0].score + bonus, type:'pair+single', row: pair.row };
      best = cand;
    }
  }

  // Bloc 3 contiguu — îl luăm doar dacă SCOAREAZĂ mai bine
  for (const [rk, rowArr] of rows.entries()) {
    const run = findContiguousRun(rowArr, 3);
    if (run) {
      const sc = adjacencyScoreSet(run, b, e, stops) + 1; // mic bonus de contiguitate
      const cand = { seats: run, score: sc, type:'block3', row: rk };
      if (!best || cand.score > best.score || (cand.score === best.score && seatOrderKey(cand.seats[0]) < seatOrderKey(best.seats[0]))) {
        best = cand;
      }
    }
  }

  // 3 single-uri (fallback)
  if (!best) {
    const singles = [];
    for (const [rk, rowArr] of rows.entries()) {
      for (const s of rowArr) singles.push({ seat:s, row:rk, score:adjacencyScoreSingle(s,b,e,stops) });
    }
    singles.sort((A,B)=>{
      if (B.score !== A.score) return B.score - A.score;
      return seatOrderKey(A.seat).localeCompare(seatOrderKey(B.seat));
    });
    if (singles.length >= 3) {
      best = { seats:[singles[0].seat, singles[1].seat, singles[2].seat], score: singles[0].score+singles[1].score+singles[2].score, type:'3singles' };
    }
  }

  if (best) log('bestTriple', best.type, best.seats.map(s=>s.label), 'score=', best.score);
  return best ? best.seats : [];
}

/* ---------- Quad / N≥4 ---------- */
// Strategie: (1) două perechi ne-suprav (scor max); (2) bloc 4; (3) o pereche + single-uri; (4) doar single-uri
function bestQuadOrMore(rows, b, e, stops, need) {
  // strâng TOATE perechile candidate
  const allPairs = [];
  for (const [rk, rowArr] of rows.entries()) {
    for (let i=0;i<rowArr.length-1;i+=1) {
      const a=rowArr[i], d=rowArr[i+1];
      if (!Number.isFinite(a?.seat_col) || !Number.isFinite(d?.seat_col)) continue;
      if (d.seat_col !== a.seat_col + 1) continue;
      const sc = adjacencyScoreSet([a,d], b, e, stops) + (samePair(a,d) ? 2 : 0);
      allPairs.push({ seats:[a,d], row: rk, score: sc });
    }
  }
  allPairs.sort((A,B)=>{
    if (B.score !== A.score) return B.score - A.score;
    return seatOrderKey(A.seats[0]).localeCompare(seatOrderKey(B.seats[0]));
  });

  // 1) două perechi ne-suprav
  for (let i=0;i<allPairs.length;i+=1) {
    const p1 = allPairs[i];
    for (let j=i+1;j<allPairs.length;j+=1) {
      const p2 = allPairs[j];
      const ids1 = new Set(p1.seats.map(s=>s.id));
      if (p2.seats.some(s=>ids1.has(s.id))) continue; // no overlap
      const chosen = [...p1.seats, ...p2.seats];
      if (need === 4) {
        log('bestQuad → twoPairs', chosen.map(s=>s.label), 'score=', p1.score+p2.score);
        return chosen;
      }
      // >4 — completăm cu single-uri cu adjacency mare
      const used = new Set(chosen.map(s=>s.id));
      const singles = [];
      for (const [rk,rowArr] of rows.entries()) {
        for (const s of rowArr) {
          if (used.has(s.id)) continue;
          singles.push({ seat:s, score: adjacencyScoreSingle(s,b,e,stops) });
        }
      }
      singles.sort((A,B)=> {
        if (B.score !== A.score) return B.score - A.score;
        return seatOrderKey(A.seat).localeCompare(seatOrderKey(B.seat));
      });
      const extras = singles.slice(0, Math.max(0, need-4)).map(x=>x.seat);
      if (chosen.length + extras.length >= need) {
        const out = [...chosen, ...extras];
        log('bestQuad → twoPairs+singles', out.map(s=>s.label));
        return out;
      }
    }
  }

  // 2) bloc 4 pe același rând (dacă scorul e bun)
  for (const [rk, rowArr] of rows.entries()) {
    const run = findContiguousRun(rowArr, 4);
    if (run) {
      if (need === 4) {
        log('bestQuad → block4', run.map(s=>s.label));
        return run;
      } else {
        const used = new Set(run.map(s=>s.id));
        const singles = [];
        for (const [rk2,rowArr2] of rows.entries()) {
          for (const s of rowArr2) {
            if (used.has(s.id)) continue;
            singles.push({ seat:s, score: adjacencyScoreSingle(s,b,e,stops) });
          }
        }
        singles.sort((A,B)=> {
          if (B.score !== A.score) return B.score - A.score;
          return seatOrderKey(A.seat).localeCompare(seatOrderKey(B.seat));
        });
        const extras = singles.slice(0, Math.max(0, need-4)).map(x=>x.seat);
        const out = [...run, ...extras];
        if (out.length >= need) { log('bestQuad → block4+singles', out.map(s=>s.label)); return out; }
      }
    }
  }

  // 3) o pereche + single-uri
  const one = allPairs[0] || null;
  if (one) {
    const used = new Set(one.seats.map(s=>s.id));
    const singles = [];
    for (const [rk,rowArr] of rows.entries()) {
      for (const s of rowArr) {
        if (used.has(s.id)) continue;
        singles.push({ seat:s, score: adjacencyScoreSingle(s,b,e,stops) });
      }
    }
    singles.sort((A,B)=> {
      if (B.score !== A.score) return B.score - A.score;
      return seatOrderKey(A.seat).localeCompare(seatOrderKey(B.seat));
    });
    const extras = singles.slice(0, Math.max(0, need-2)).map(x=>x.seat);
    const out = [...one.seats, ...extras];
    if (out.length >= need) { log('bestQuad → pair+singles', out.map(s=>s.label)); return out; }
  }

  // 4) doar single-uri
  const singlesAll = flattenRows(rows).map(s=>({ seat:s, score: adjacencyScoreSingle(s,b,e,stops) }));
  singlesAll.sort((A,B)=> {
    if (B.score !== A.score) return B.score - A.score;
    return seatOrderKey(A.seat).localeCompare(seatOrderKey(B.seat));
  });
  const outSingles = singlesAll.slice(0, need).map(x=>x.seat);
  if (outSingles.length === need) { log('bestQuad → singles only', outSingles.map(s=>s.label)); return outSingles; }
  return [];
}

/* ---------- API principal ---------- */
export function selectSeats(seats, board_at, exit_at, stops, count) {
  log('selectSeats START', { count, board_at, exit_at });
  const { rows, guides, b, e } = buildFreeSeats(seats, board_at, exit_at, stops);
  const need = Math.max(1, Number(count)||1);

  const anyRowHasSeats = [...rows.values()].some(a=>a.length>0);
  if (!anyRowHasSeats) {
    log('No rows available, considering GHID seats only');
    if (guides.length > 0) return guides.slice(0, Math.min(need, guides.length));
    return [];
  }

  if (need === 1) {
    const s = pickSingle(rows, b, e, stops);
    if (s.length) return s;
    return guides.length ? [guides[0]] : [];
  }

  if (need === 2) {
    const bp = bestPair(rows, b, e, stops);
    if (bp) return bp.seats;
    // dacă nu există perechi deloc: 2 single-uri cu adjacency mare
    const singles = flattenRows(rows)
      .map(s=>({ seat:s, score:adjacencyScoreSingle(s,b,e,stops) }))
      .sort((A,B)=> (B.score-A.score) || seatOrderKey(A.seat).localeCompare(seatOrderKey(B.seat)))
      .slice(0,2).map(x=>x.seat);
    if (singles.length===2) { log('need=2 → singles', singles.map(s=>s.label)); return singles; }
    return guides.slice(0, Math.min(2, guides.length));
  }

  if (need === 3) {
    const triple = bestTriple(rows, b, e, stops);
    if (triple.length === 3) return triple;
    return guides.slice(0, Math.min(3, guides.length));
  }

  // need >= 4
  const quad = bestQuadOrMore(rows, b, e, stops, need);
  if (quad.length >= Math.min(need,4)) return quad;

  if (guides.length > 0) return guides.slice(0, Math.min(need, guides.length));
  return [];
}

export function getBestAvailableSeat(seats, board_at, exit_at, stops, excludeIds = []) {
  const filtered = (seats || []).filter((s) => !excludeIds?.includes?.(s?.id));
  const list = selectSeats(filtered, board_at, exit_at, stops, 1);
  const chosen = list[0] || null;
  log('getBestAvailableSeat →', chosen?.label ?? null);
  return chosen;
}
export function getBestSeatCandidate(seats, board_at, exit_at, stops, excludeIds = []) {
  const filtered = (seats || []).filter((s) => !excludeIds?.includes?.(s?.id));
  const list = selectSeats(filtered, board_at, exit_at, stops, 1);
  const chosen = list[0] || null;
  log('getBestSeatCandidate →', chosen?.label ?? null);
  return chosen;
}
