// SMS provider abstraction. Every provider reports its own status and can send
// a message, throwing on failure. Providers are swapped at runtime by reading
// the current settings, so flipping the provider in Admin > Settings takes
// effect on the next queued message.
import type { Settings, SmsProviderId, ProviderStatus } from '../../../shared/types';

export interface SmsProvider {
  readonly id: SmsProviderId;
  /** Config/state-based status — instant, never performs network I/O. */
  getStatus(settings: Settings): ProviderStatus;
  /** Live status check (may do lightweight network verification). */
  verify(settings: Settings): Promise<ProviderStatus>;
  send(settings: Settings, phone: string, message: string): Promise<void>;
  /** Optional dispatch capacity used to size outbox claims. */
  getRecommendedConcurrency?(settings: Settings): number;
  /** Optional background health/reconnect lifecycle. */
  start?(getSettings: () => Settings): void;
  stop?(): void;
}

import { SimulatorProvider } from './simulator';
import { GsmSerialProvider } from './gsm-serial';
import { CloudProvider } from './cloud';

const registry: Record<SmsProviderId, SmsProvider> = {
  simulator: new SimulatorProvider(),
  gsm: new GsmSerialProvider(),
  cloud: new CloudProvider(),
};

export function getProvider(id: SmsProviderId): SmsProvider {
  return registry[id] ?? registry.simulator;
}
