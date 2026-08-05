// Simulated SMS provider. Lets the whole system run with zero hardware: it
// waits ~700ms and reports success. Delivery is visible in the SMS Outbox
// with provider = "simulator".
import type { Settings, SmsProviderId, ProviderStatus } from '../../../shared/types';
import type { SmsProvider } from './index';

export class SimulatorProvider implements SmsProvider {
  readonly id: SmsProviderId = 'simulator';

  getStatus(_settings: Settings): ProviderStatus {
    return {
      provider: 'simulator',
      online: true,
      detail: 'Simulator active — no real SMS sent',
    };
  }

  async verify(_settings: Settings): Promise<ProviderStatus> {
    return this.getStatus(_settings);
  }

  async send(_settings: Settings, phone: string, message: string): Promise<void> {
    await new Promise((r) => setTimeout(r, 700));
    // eslint-disable-next-line no-console
    console.log(`[SIM-SMS] -> ${phone}: ${message}`);
  }
}
