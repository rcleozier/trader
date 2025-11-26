import twilio from 'twilio';
import { config } from '../config';
import { Mispricing } from '../types/markets';

export class NotificationService {
  private client: twilio.Twilio;

  constructor() {
    this.client = twilio(
      config.twilio.accountSid,
      config.twilio.authToken
    );
  }

  /**
   * Send SMS alert with mispricing information
   */
  async sendMispricingAlert(mispricings: Mispricing[]): Promise<void> {
    if (mispricings.length === 0) {
      console.log('No mispricings detected, skipping SMS alert');
      return;
    }

    const message = this.formatMispricingMessage(mispricings);

    try {
      const result = await this.client.messages.create({
        body: message,
        from: config.twilio.fromNumber,
        to: config.twilio.alertToNumber,
      });

      console.log(`SMS alert sent successfully. SID: ${result.sid}`);
    } catch (error: any) {
      throw new Error(`Failed to send SMS alert: ${error.message}`);
    }
  }

  /**
   * Format mispricings into SMS message
   */
  private formatMispricingMessage(mispricings: Mispricing[]): string {
    let message = `🏀 NBA Mispricing Alert (${mispricings.length} found)\n\n`;

    for (const mispricing of mispricings) {
      const { game, side, kalshiImpliedProbability, sportsbookImpliedProbability, 
              sportsbookOdds, differencePct } = mispricing;

      const team = side === 'home' ? game.homeTeam : game.awayTeam;
      const kalshiPct = (kalshiImpliedProbability * 100).toFixed(1);
      const espnPct = (sportsbookImpliedProbability * 100).toFixed(1);
      const oddsSign = sportsbookOdds > 0 ? '+' : '';

      message += `${game.awayTeam} @ ${game.homeTeam}\n`;
      message += `${team} (${side}):\n`;
      message += `  Kalshi: ${kalshiPct}%\n`;
      message += `  ESPN: ${espnPct}% (${oddsSign}${sportsbookOdds})\n`;
      message += `  Diff: ${differencePct.toFixed(1)}pp\n\n`;
    }

    return message.trim();
  }
}
