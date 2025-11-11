// src/utils/validation.js

export function isPassengerValid(passenger) {
  const { name, phone } = passenger;

  const hasName = name?.trim().length > 0;
  const hasPhone = phone?.trim().length > 0;

  const nameValid = !name || /^[a-zA-Z0-9ăîâșțĂÎÂȘȚ \-]+$/.test(name.trim());

  // Eliminăm spațiile și validăm formatul
  const cleanedPhone = phone?.replace(/\s+/g, '') || '';
  const phoneValid = !phone || /^(\+)?\d{10,}$/.test(cleanedPhone);



  const hasAtLeastOne = hasName || hasPhone;

  return {
    valid: hasAtLeastOne && nameValid && phoneValid,
    errors: {
      name: hasName && !nameValid ? 'Numele poate conține doar litere, cifre, spații și -' : '',
      phone: hasPhone && !phoneValid ? 'Telefonul trebuie să aibă minim 10 cifre și poate începe cu +' : '',
      general: !hasAtLeastOne ? 'Completează cel puțin numele sau telefonul' : ''
    }
  };
}
