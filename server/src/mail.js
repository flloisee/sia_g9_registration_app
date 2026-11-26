import nodemailer from 'nodemailer';

let transportPromise;

// Don't let a dead SMTP host stall the registration request.
const timeouts = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };

async function createTransport() {
  // Gmail app password: SMTP_USER is the full address, SMTP_PASS the 16-char
  // app password from https://myaccount.google.com/apppasswords (2FA required).
  if (process.env.SMTP_USER) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    return {
      transporter: nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
        port,
        secure: process.env.SMTP_SECURE === 'true' || port === 465,
        ...timeouts,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' },
      }),
      from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
    };
  }

  // No SMTP configured: fall back to a throwaway Ethereal inbox so the flow
  // can be verified locally. Every send prints a preview URL to the console.
  const account = await nodemailer.createTestAccount();
  console.warn(`[mail] SMTP_USER not set — using Ethereal test inbox ${account.user}`);
  return {
    transporter: nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      ...timeouts,
      auth: { user: account.user, pass: account.pass },
    }),
    from: `"Tickets" <${account.user}>`,
  };
}

function getTransport() {
  transportPromise ??= createTransport();
  return transportPromise;
}

const escapeHtml = (value) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export async function sendTicketEmail(attendee) {
  const { transporter, from } = await getTransport();
  const name = escapeHtml(attendee.fullName);
  const code = escapeHtml(attendee.code);
  const eventName = attendee.eventName?.trim() || 'Event';

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c22;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e7e5e0;border-radius:16px;">
          <tr><td style="padding:32px 32px 8px;">
            <p style="margin:0 0 24px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#6b6b76;">${escapeHtml(eventName)}</p>
            <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;letter-spacing:-0.01em;">You're in, ${name}.</h1>
            <p style="margin:0;font-size:15px;line-height:1.6;color:#4a4a55;">Your ticket is below. Show this QR code at the door and we'll check you in.</p>
          </td></tr>
          <tr><td align="center" style="padding:24px 32px 8px;">
            <img src="cid:ticket-qr" width="220" height="220" alt="Your ticket QR code" style="display:block;border:1px solid #e7e5e0;border-radius:12px;padding:12px;background:#ffffff;">
          </td></tr>
          <tr><td align="center" style="padding:8px 32px 32px;">
            <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#8a8a94;">Ticket code</p>
            <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:20px;letter-spacing:0.18em;font-weight:600;">${code}</p>
          </td></tr>
          <tr><td style="padding:20px 32px 32px;border-top:1px solid #f0eeea;">
            <p style="margin:0;font-size:13px;line-height:1.6;color:#6b6b76;">The QR code is also attached as an image. This ticket is personal — please don't forward it.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = `You're registered for ${eventName}, ${attendee.fullName}.\n\nTicket code: ${attendee.code}\n\nShow the attached QR code (or this code) at the door.\n`;

  const info = await transporter.sendMail({
    from,
    to: attendee.email,
    subject: `Your ${eventName} ticket — ${attendee.code}`,
    text,
    html,
    attachments: [
      {
        filename: 'ticket-qr.png',
        content: attendee.qrPng,
        cid: 'ticket-qr',
      },
    ],
  });

  return { previewUrl: nodemailer.getTestMessageUrl(info) || null };
}

export async function sendEmailChangeEmail({ to, name, confirmUrl }) {
  const { transporter, from } = await getTransport();
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(confirmUrl);

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c22;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e7e5e0;border-radius:16px;">
          <tr><td style="padding:32px;">
            <p style="margin:0 0 24px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#6b6b76;">Event Manager</p>
            <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;letter-spacing:-0.01em;">Confirm your email, ${safeName}.</h1>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a4a55;">An admin added this address to your volunteer account. Confirm it to finish the change.</p>
            <p style="margin:0 0 24px;"><a href="${safeUrl}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#1c1c22;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Confirm email address</a></p>
            <p style="margin:0;font-size:13px;line-height:1.6;color:#6b6b76;">This link expires in 24 hours. If you weren't expecting this, ignore this email.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = `An admin added this address to your volunteer account, ${name}.\n\nConfirm it within 24 hours:\n${confirmUrl}\n\nIf you weren't expecting this, ignore this email.\n`;

  const info = await transporter.sendMail({
    from,
    to,
    subject: 'Confirm your volunteer email address',
    text,
    html,
  });

  return { previewUrl: nodemailer.getTestMessageUrl(info) || null };
}
