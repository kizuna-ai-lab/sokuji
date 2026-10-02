import { VolcengineIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { createAst2Adapter } from './adapter';
import { Ast2SettingsView } from './Ast2Settings';
import { checkAst2 } from './check';
import { buildAst2, describeAst2, type Ast2Config } from './config';
import { AST2_DEFAULTS, ast2Credentials, ast2Languages, migrateAst2Settings, type Ast2Credentials, type Ast2Settings } from './settings';

const adapter = createAst2Adapter();

/**
 * Doubao AST 2.0 with the user's own credentials (Stage 2 Volcengine AST2):
 * Volcengine's simultaneous interpretation, one protobuf socket per leg,
 * speech to speech — in the speaker's cloned voice or a catalog voice (#577)
 * — or speech to text. The old enum's id and slice (controller ruling 2 of
 * the foundation), so a stored selection, the credentials and the libraries
 * carry over. Its credentials ride in the socket's query (ruling 2), so it
 * runs on the web too; the extension's manifest lists its host, and its CSP
 * the voice-sample CDN the catalog's previews fetch from. Released between Gemini and Soniox, unflagged
 * (ruling 5); the old `VITE_ENABLE_VOLCENGINE_AST2` is dead and not read.
 */
export const volcengineAst2Provider: Provider<Ast2Settings, Ast2Credentials, Ast2Config> & { id: 'volcengine_ast2' } = {
  id: 'volcengine_ast2',
  kind: 'own-key',
  platforms: ['electron', 'extension', 'web'],
  icon: VolcengineIcon,
  // Today's TUTORIAL_URLS value, as a literal (no import from src/services).
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/volcengine-ast2-setup',

  settings: { key: 'volcengineAST2', defaults: AST2_DEFAULTS, migrate: migrateAst2Settings },
  Settings: Ast2SettingsView,

  // Two credential modes (ruling 1): the choice sits above the fields, in both layouts.
  credentials: ast2Credentials,
  check: (k, s, ctx) => checkAst2(k, s, ctx),
  // The credential mode picks the credential fields; the libraries and the voice are not checked.
  checkReads: ['authMode'],

  // The offer follows whether the run speaks (ruling 3; choice 1).
  languages: ast2Languages,

  speech: 'optional',
  // Doubao's session takes audio only.
  textInput: () => false,
  // The server's End phase ends a segment (the old offer: pause off, auto and sizes on).
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: buildAst2,
  describe: describeAst2,
  start: adapter.start,
};
