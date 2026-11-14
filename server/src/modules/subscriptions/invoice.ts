import type { Payment, Subscription, User } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { config } from '../../config.js';
import { PLANS } from '../../lib/plans.js';

// Built-in PDF fonts have no ₹ glyph, so amounts use the ISO code.
const inr = (paise: number) => `INR ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const date = (d: Date) => d.toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });
const dateTime = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';

/** Invoice + payment receipt as a single-page PDF. */
export function invoicePdf(payment: Payment, user: User, sub: Subscription | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const plan = PLANS[payment.plan];
    const accent = '#e11d48';

    doc.rect(0, 0, doc.page.width, 90).fill(accent);
    doc.fillColor('#ffffff').fontSize(24).font('Helvetica-Bold').text('StreamHub', 50, 32);
    doc.fontSize(11).font('Helvetica').text('TAX INVOICE / PAYMENT RECEIPT', 50, 38, { align: 'right' });

    doc.fillColor('#18181b').moveDown(4);
    let y = 120;
    doc.fontSize(10).fillColor('#71717a').text('BILLED TO', 50, y);
    doc.text('INVOICE', 330, y);
    y += 16;
    doc.fillColor('#18181b').fontSize(11).font('Helvetica-Bold').text(user.name, 50, y);
    doc.font('Helvetica-Bold').text(payment.invoiceNumber ?? 'Pending', 330, y);
    y += 16;
    doc.font('Helvetica').fontSize(10).text(user.email, 50, y);
    doc.text(`Date: ${payment.paidAt ? date(payment.paidAt) : date(payment.createdAt)}`, 330, y);
    y += 14;
    if (user.phone) doc.text(user.phone, 50, y);
    doc.text(`Status: ${payment.status}`, 330, y);

    // Line item table
    y += 40;
    doc.rect(50, y, 495, 24).fill('#f4f4f5');
    doc.fillColor('#52525b').fontSize(10).font('Helvetica-Bold');
    doc.text('Description', 60, y + 7);
    doc.text('Period', 300, y + 7);
    doc.text('Amount', 440, y + 7, { width: 95, align: 'right' });
    y += 34;
    doc.fillColor('#18181b').font('Helvetica');
    const label = `${plan.name} plan — ${payment.action.toLowerCase()}`;
    doc.text(label, 60, y);
    doc.text(sub ? `${date(sub.startDate)} – ${date(sub.expiryDate)}` : payment.period.toLowerCase(), 300, y, { width: 140 });
    doc.text(inr(plan.prices[payment.period]), 440, y, { width: 95, align: 'right' });
    y += 22;
    const credit = plan.prices[payment.period] - payment.amount;
    if (credit > 0) {
      doc.fillColor('#16a34a').text('Credit for unused time on previous plan', 60, y);
      doc.text(`- ${inr(credit)}`, 440, y, { width: 95, align: 'right' });
      y += 22;
    }
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#e4e4e7').stroke();
    y += 12;
    doc.fillColor('#18181b').font('Helvetica-Bold').fontSize(12).text('Total paid', 300, y);
    doc.text(inr(payment.amount), 400, y, { width: 135, align: 'right' });

    // Transaction details
    y += 50;
    doc.fontSize(10).fillColor('#71717a').font('Helvetica').text('TRANSACTION DETAILS', 50, y);
    y += 16;
    const details: [string, string][] = [
      ['Payment ID', payment.razorpayPaymentId ?? '—'],
      ['Order ID', payment.razorpayOrderId],
      ['Currency', payment.currency],
      ['Paid at', payment.paidAt ? dateTime(payment.paidAt) : '—'],
      ['Gateway', 'Razorpay (test mode)'],
      ['Validity', sub ? `${date(sub.startDate)} to ${date(sub.expiryDate)}` : '—'],
    ];
    doc.fillColor('#18181b');
    for (const [k, v] of details) {
      doc.font('Helvetica').fillColor('#52525b').text(k, 50, y);
      doc.font('Helvetica').fillColor('#18181b').text(v, 180, y);
      y += 16;
    }

    doc
      .fontSize(9)
      .fillColor('#71717a')
      .text(
        `Questions about this invoice? Contact ${config.supportEmail}. This is a computer-generated receipt and does not need a signature.`,
        50,
        760,
        { width: 495, align: 'center' },
      );
    doc.end();
  });
}
