import React, { useEffect } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';

export default function CalendarWrapper({ selectedDate, setSelectedDate }) {
  const handleChange = (date) => {
    setSelectedDate(date);
    console.log('[CalendarWrapper] Selectat:', date.toISOString().split('T')[0]);
  };

  return (
    <div className="bg-white border rounded-lg p-3 w-full shadow-sm">
      <Calendar
        onChange={handleChange}
        value={selectedDate}
        locale="ro-RO"
       
        tileClassName={({ date }) => {
          const isSameDay =
            date.getDate() === selectedDate.getDate() &&
            date.getMonth() === selectedDate.getMonth() &&
            date.getFullYear() === selectedDate.getFullYear();
          return isSameDay ? 'bg-blue-500 text-white font-bold rounded' : null;
        }}
      />
    </div>
  );
}
