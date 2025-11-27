import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';
import { config } from '../config';
import * as fs from 'fs';
import * as path from 'path';

export class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    // Setup SendGrid if configured
    if (config.sendgrid) {
      sgMail.setApiKey(config.sendgrid.apiKey);
    }
    
    // Setup SMTP transporter if configured
    if (config.email) {
      this.transporter = nodemailer.createTransport({
        host: config.email.smtpHost,
        port: config.email.smtpPort,
        secure: config.email.smtpSecure, // true for 465, false for other ports
        auth: {
          user: config.email.smtpUser,
          pass: config.email.smtpPassword,
        },
      });
    }
  }

  /**
   * Send PDF report via email (using SendGrid or SMTP)
   */
  async sendPDFReport(pdfPath: string): Promise<void> {
    // Try SMTP first (simpler, no service required)
    if (this.transporter && config.email) {
      try {
        const pdfBuffer = fs.readFileSync(pdfPath);
        
        await this.transporter.sendMail({
          from: config.email.fromEmail,
          to: config.email.toEmail,
          subject: `Mispricing Report - ${new Date().toLocaleDateString()}`,
          text: 'Please find attached the mispricing report.',
          html: `
            <h2>Mispricing Report</h2>
            <p>Please find attached the mispricing report generated on ${new Date().toLocaleString()}.</p>
            <p>This report contains:</p>
            <ul>
              <li>Account balance</li>
              <li>Active positions</li>
              <li>All games with Kalshi and ESPN comparison data</li>
              <li>Mispricing opportunities above threshold</li>
            </ul>
          `,
          attachments: [
            {
              filename: path.basename(pdfPath),
              content: pdfBuffer,
            },
          ],
        });
        
        console.log(`✅ PDF report sent successfully via SMTP to ${config.email.toEmail}`);
        return;
      } catch (error: any) {
        console.error(`❌ Failed to send PDF report via SMTP: ${error.message}`);
        // Fall through to try SendGrid if configured
      }
    }
    
    // Fallback to SendGrid if configured
    if (config.sendgrid) {
      try {
        const pdfBuffer = fs.readFileSync(pdfPath);
        const pdfBase64 = pdfBuffer.toString('base64');

        const msg = {
          to: config.sendgrid.emailAddress,
          from: config.sendgrid.emailAddress, // SendGrid requires verified sender
          subject: `Mispricing Report - ${new Date().toLocaleDateString()}`,
          text: 'Please find attached the mispricing report.',
          html: `
            <h2>Mispricing Report</h2>
            <p>Please find attached the mispricing report generated on ${new Date().toLocaleString()}.</p>
            <p>This report contains:</p>
            <ul>
              <li>Account balance</li>
              <li>Active positions</li>
              <li>All games with Kalshi and ESPN comparison data</li>
              <li>Mispricing opportunities above threshold</li>
            </ul>
          `,
          attachments: [
            {
              content: pdfBase64,
              filename: path.basename(pdfPath),
              type: 'application/pdf',
              disposition: 'attachment',
            },
          ],
        };

        await sgMail.send(msg);
        console.log(`✅ PDF report sent successfully via SendGrid to ${config.sendgrid.emailAddress}`);
        return;
      } catch (error: any) {
        console.error(`❌ Failed to send PDF report via SendGrid: ${error.message}`);
        if (error.response) {
          console.error('SendGrid error details:', error.response.body);
        }
        throw error;
      }
    }
    
    console.log('No email configuration found. Skipping email send.');
  }
}
