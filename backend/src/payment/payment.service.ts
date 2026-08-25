import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { CashfreeService } from './cashfree.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly cashfreeService: CashfreeService,
  ) {}

  /**
   * Create a Payment Request using Cashfree Gateway
   */
  async createPaymentRequest(params: {
    userId?: string;
    businessId: string;
    plan: string;
    redirectUrl?: string;
  }) {
    return this.cashfreeService.createPaymentRequest(params);
  }

  /**
   * Verify and process Cashfree Callback
   */
  async processCallback(payload: any, signature?: string, timestamp?: string, rawBody?: string) {
    return this.cashfreeService.processCallback(payload, signature, timestamp, rawBody);
  }

  /**
   * Get / Verify Payment status by transaction ID
   */
  async getPaymentStatus(transactionId: string) {
    return this.cashfreeService.verifyPaymentStatus(transactionId);
  }

  /**
   * Download payment invoice as PNG/Image buffer (branded receipt)
   */
  async downloadInvoice(paymentId: string): Promise<{ pdfBuffer: Buffer; fileName: string }> {
    this.logger.log(`Generating invoice for paymentId: ${paymentId}`);

    let paymentData: any = null;
    const directDoc = await this.firebase.col('payments').doc(paymentId).get();
    if (directDoc.exists) {
      paymentData = directDoc.data();
    } else {
      const snap = await this.firebase.col('payments').where('paymentId', '==', paymentId).limit(1).get();
      if (!snap.empty) paymentData = snap.docs[0].data();
    }

    if (!paymentData) {
      throw new NotFoundException(`Payment record not found for ID: ${paymentId}`);
    }

    const { createCanvas } = await import('@napi-rs/canvas');
    const width = 794;
    const height = 1123;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#0B1727';
    ctx.fillRect(0, 0, width, height);

    // Header bar
    const headerGrad = ctx.createLinearGradient(0, 0, width, 0);
    headerGrad.addColorStop(0, '#7C3AED');
    headerGrad.addColorStop(1, '#6366F1');
    ctx.fillStyle = headerGrad;
    ctx.fillRect(0, 0, width, 120);

    // Company name
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('Visionpilot AI', 40, 60);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('Meta Authorised AI Marketing Agent • Tax Invoice', 40, 90);

    // Invoice badge
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(width - 200, 30, 160, 60);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('INVOICE', width - 170, 58);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(new Date(paymentData.createdAt || Date.now()).toLocaleDateString('en-IN'), width - 175, 78);

    // Details section
    const details = [
      ['Plan', paymentData.plan || paymentData.planId || 'N/A'],
      ['Amount', `₹${(paymentData.amount || 0).toFixed(2)} ${paymentData.currency || 'INR'}`],
      ['Status', paymentData.status || 'N/A'],
      ['Payment Provider', paymentData.provider || 'CASHFREE'],
      ['Transaction ID', paymentData.merchantTransactionId || paymentId],
      ['Business ID', paymentData.businessId || 'N/A'],
      ['Date', new Date(paymentData.createdAt || Date.now()).toLocaleDateString('en-IN')],
    ];

    let y = 180;
    for (const [label, value] of details) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(40, y, width - 80, 48);
      ctx.fillStyle = 'rgba(124,58,237,0.8)';
      ctx.fillRect(40, y, 4, 48);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '13px sans-serif';
      ctx.fillText(label, 60, y + 20);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(String(value), 60, y + 40);
      y += 60;
    }

    // Footer
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(0, height - 80, width, 80);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '13px sans-serif';
    ctx.fillText('Thank you for your business! Support: support@visionpilot.ai', 40, height - 45);
    ctx.fillText('Visionpilot AI Technologies © 2026 — Meta Authorised AI Marketing Agent', 40, height - 25);

    const pdfBuffer = canvas.toBuffer('image/png');
    const fileName = `Invoice_${paymentId}_${Date.now()}.png`;

    return { pdfBuffer, fileName };
  }
}
