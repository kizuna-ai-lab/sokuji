// The notes model as History and notes stored it before the notes could be written by each text-model service: read
// once into OpenAI's text model's notes model (text models, part C), only where the user had changed it.
import { describe, it, expect } from 'vitest';
import { OLD_NOTES_DEFAULT, OLD_NOTES_MODELS, notesModelFromOld } from './oldNotesModel';

describe('the old notes model', () => {
  it('was chosen from the newest OpenAI series, Luna first, Luna by default', () => {
    expect(OLD_NOTES_MODELS).toEqual(['gpt-6-luna', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6.1-terra']);
    expect(OLD_NOTES_DEFAULT).toBe('gpt-6-luna');
  });

  it('never changed, or left at the default, is Automatic: whose first choice for OpenAI is that same model', () => {
    for (const old of [undefined, null, '', '  ', 'gpt-6-luna', ' gpt-6-luna ', 42, true]) {
      expect(notesModelFromOld(old), String(old)).toEqual({ listed: '', typed: '' });
    }
  });

  it("another of the list's models is the one chosen from the list; a name typed under Other is the name typed", () => {
    expect(notesModelFromOld('gpt-6.1-terra')).toEqual({ listed: 'gpt-6.1-terra', typed: '' });
    expect(notesModelFromOld(' o3 ')).toEqual({ listed: '', typed: 'o3' });
  });
});
