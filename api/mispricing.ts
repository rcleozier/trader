import { runMispricingCheck } from '../src/index';

// Vercel Serverless Function entrypoint.
// This will be triggered by a Vercel Cron Job on a schedule.
export default async function handler(req: any, res: any) {
  try {
    await runMispricingCheck();
    res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error('Error running mispricing check via Vercel cron:', error);
    res
      .status(500)
      .json({ ok: false, error: error?.message || 'Unknown error' });
  }
}


