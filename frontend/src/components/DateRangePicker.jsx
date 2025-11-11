export default function DateRangePicker({ value, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });

  return (
    <div className="flex items-center gap-1">
      <label className="text-sm">de la</label>
      <input
        type="date"
        value={value.start}
        onChange={set('start')}
        className="border rounded px-2 py-1"
      />
      <label className="text-sm">până la</label>
      <input
        type="date"
        value={value.end}
        onChange={set('end')}
        className="border rounded px-2 py-1"
      />
    </div>
  );
}
