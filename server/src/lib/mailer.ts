import nodemailer from 'nodemailer';
import { config } from '../config.js';

export const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
});

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

export async function sendMail(input: MailInput) {
  try {
    await transporter.sendMail({ from: config.smtp.from, ...input });
    return true;
  } catch (err) {
    console.error('[mail] failed to send', input.subject, 'to', input.to, err);
    return false;
  }
}

/** Shared email shell so every message looks consistent. */
export function emailLayout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Segoe UI,Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
    <tr><td style="background:#e11d48;color:#fff;padding:20px 28px;font-size:20px;font-weight:700">StreamHub</td></tr>
    <tr><td style="padding:28px;color:#18181b;font-size:15px;line-height:1.6">
      <h2 style="margin:0 0 16px;font-size:20px">${title}</h2>${body}
    </td></tr>
    <tr><td style="padding:16px 28px;background:#fafafa;color:#71717a;font-size:12px">
      Need help? Contact <a href="mailto:${config.supportEmail}">${config.supportEmail}</a>
    </td></tr>
  </table></td></tr></table></body></html>`;
}
