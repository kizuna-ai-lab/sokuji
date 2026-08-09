/**
 * The seam SonioxVoiceSection sits on.
 *
 * The section used to construct a SonioxVoicesClient from `settings.apiKey`
 * and short-circuit it to null for managed accounts, which is why the managed
 * twin could only ever show built-in voices. Lifting that construction out
 * turns "where do voices come from" into a parameter: BYOK talks to Soniox
 * directly with the user's project key, managed talks to our backend with a
 * session token, and the section itself stops knowing the difference.
 *
 * `canPreview` is part of the contract because auditioning a voice means
 * synthesizing a sample, which needs a Soniox key the managed user does not
 * have. That is a property of the SOURCE, not of the section.
 */
import type { SonioxVoice, SonioxVoicesClient } from '../../../services/clients/SonioxVoicesClient';

export interface VoiceLibrarySource {
  /** Every voice this source can offer. The managed source returns zero or
   *  one, so the section's list rendering is unchanged either way. */
  list(): Promise<SonioxVoice[]>;
  create(name: string, clip: Blob, fileName?: string): Promise<SonioxVoice>;
  delete(id: string): Promise<void>;
  waitUntilReady(id: string): Promise<SonioxVoice>;
  /** False when auditioning is impossible because this source has no Soniox
   *  key to synthesize a sample with. */
  readonly canPreview: boolean;
}

/** BYOK: SonioxVoicesClient already satisfies the interface; this only names
 *  the fact and pins `canPreview`. */
export function byokVoiceSource(client: SonioxVoicesClient): VoiceLibrarySource {
  return {
    list: () => client.list(),
    create: (name, clip, fileName) => client.create(name, clip, fileName),
    delete: (id) => client.delete(id),
    waitUntilReady: (id) => client.waitUntilReady(id),
    canPreview: true,
  };
}
