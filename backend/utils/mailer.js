const net = require('net');
const tls = require('tls');
const os = require('os');

function parseBool(value, defaultValue = false) {
  if (typeof value === 'undefined' || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function validateMailerConfig() {
  const missing = [];
  if (!process.env.SMTP_HOST) missing.push('SMTP_HOST');
  if (!process.env.SMTP_PORT) missing.push('SMTP_PORT');
  if (!process.env.SMTP_FROM) missing.push('SMTP_FROM');

  const hasUser = Boolean(process.env.SMTP_USER);
  const hasPass = Boolean(process.env.SMTP_PASS);
  const wantsAuth = hasUser || hasPass;
  if (wantsAuth && !hasUser) missing.push('SMTP_USER');
  if (wantsAuth && !hasPass) missing.push('SMTP_PASS');

  return {
    ok: missing.length === 0,
    missing,
    wantsAuth,
    hasAuth: hasUser && hasPass,
  };
}

function isMailerConfigured() {
  return validateMailerConfig().ok;
}

function createConnection() {
  return new Promise((resolve, reject) => {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT);
    if (!host || Number.isNaN(port)) {
      return reject(new Error('SMTP_HOST/SMTP_PORT lipsesc'));
    }

    const secure = parseBool(process.env.SMTP_SECURE, port === 465);
    const options = {
      host,
      port,
      timeout: 15000,
    };

    const handleError = (err) => {
      reject(err);
    };

    const onConnect = function onConnect() {
      this.removeListener('error', handleError);
      resolve(this);
    };

    const socket = secure ? tls.connect(options, onConnect) : net.createConnection(options, onConnect);
    socket.setEncoding('utf8');
    socket.once('error', handleError);
  });
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';

    const cleanup = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('timeout', onTimeout);
    };

    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (!lines.length) {
        return;
      }
      const last = lines[lines.length - 1];
      if (/^\d{3} /.test(last)) {
        cleanup();
        resolve(lines.join('\n'));
      }
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    const onTimeout = () => {
      cleanup();
      reject(new Error('SMTP timeout'));
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
    socket.setTimeout(15000);
  });
}

function codeFromResponse(response) {
  return parseInt(response.slice(0, 3), 10);
}

async function sendCommand(socket, command, expectedCodes) {
  if (command) {
    socket.write(`${command}\r\n`);
  }
  const response = await readResponse(socket);
  const code = codeFromResponse(response);
  if (expectedCodes && ![].concat(expectedCodes).includes(code)) {
    throw new Error(`SMTP ${command || '<no command>'} a întors ${code}: ${response}`);
  }
  return { response, code };
}

function formatAddress(address) {
  if (!address) return '';
  if (/<.+>/.test(address)) return address;
  return `<${address}>`;
}

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function buildMessage({ to, subject, text, html, from }) {
  const recipients = ensureArray(to).join(', ');
  const messageId = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@${process.env.SMTP_MESSAGE_DOMAIN || os.hostname() || 'localhost'}`;
  const headers = [
    `From: ${from}`,
    `To: ${recipients}`,
    `Subject: ${subject || ''}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
  ];

  let body = '';
  if (html) {
    const boundary = `ALT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      text || 'Mulțumim pentru înregistrare!',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
      `--${boundary}--`,
      '',
    ].join('\r\n');
  } else {
    headers.push('Content-Type: text/plain; charset=utf-8');
    body = `\r\n${text || 'Mulțumim pentru înregistrare!'}`;
  }

  return `${headers.join('\r\n')}\r\n\r\n${body.replace(/\n\./g, '\n..')}`;
}

async function sendMail(options) {
  const status = validateMailerConfig();
  if (!status.ok) {
    throw new Error(`SMTP nu este configurat corect. Lipsesc variabile: ${status.missing.join(', ')}`);
  }

  const from = options.from || process.env.SMTP_FROM;
  const toList = ensureArray(options.to);
  if (!toList.length) {
    throw new Error('Lipsea adresa de destinație pentru email');
  }

  const socket = await createConnection();
  try {
    await readResponse(socket); // greeting 220
    await sendCommand(socket, `EHLO ${process.env.SMTP_EHLO_DOMAIN || os.hostname() || 'localhost'}`, [250]);

    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      await sendCommand(socket, 'AUTH LOGIN', [334]);
      await sendCommand(socket, Buffer.from(process.env.SMTP_USER).toString('base64'), [334]);
      await sendCommand(socket, Buffer.from(process.env.SMTP_PASS).toString('base64'), [235]);
    }

    await sendCommand(socket, `MAIL FROM:${formatAddress(from)}`, [250]);
    for (const recipient of toList) {
      await sendCommand(socket, `RCPT TO:${formatAddress(recipient)}`, [250, 251]);
    }

    await sendCommand(socket, 'DATA', [354]);
    const message = buildMessage({ ...options, from, to: toList });
    socket.write(`${message}\r\n.\r\n`);
    await readResponse(socket); // 250
    await sendCommand(socket, 'QUIT', [221]);
  } finally {
    socket.end();
  }

  return true;
}

async function sendMailSafe(options) {
  if (!isMailerConfigured()) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[mailer] SMTP nu este configurat. Emailul nu a fost trimis.');
    }
    return null;
  }

  try {
    return await sendMail(options);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[mailer] trimitere email eșuată:', err?.message || err);
    }
    return null;
  }
}

module.exports = {
  validateMailerConfig,
  isMailerConfigured,
  sendMail,
  sendMailSafe,
};
