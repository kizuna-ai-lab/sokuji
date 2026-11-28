/* Internal to libsokuji_native (and compiled into tests/test_locale.cpp). Never installed. */
#pragma once

namespace sk {
/* For the lifetime of the guard, this thread classifies characters in the "C" locale (LC_CTYPE only;
 * nothing else of the process's locale changes, and no other thread is affected). audio.cpp passes the
 * bytes of UTF-8 text one by one to std::isspace (voxcpm1/voxcpm2's normalize_wrapper_text collapses them,
 * and supertonic, pocket_tts, omnivoice and index_tts2 trim with it). Under a UTF-8 LC_CTYPE, Apple's libc
 * answers true for 0xA0 and 0x85, which are continuation bytes of e.g. 「你」 (E4 BD A0): the byte is
 * replaced or dropped and the tokenizer rejects the text as broken UTF-8. Any library in the process may
 * call setlocale, so every audio.cpp entry point runs under this guard. A no-op on Windows: the hazard
 * was found on macOS and does not occur with glibc, and the Windows CRT has no uselocale; its
 * per-thread alternative (_configthreadlocale + setlocale) would change more than LC_CTYPE. */
class CtypeCLocale {
  public:
    CtypeCLocale();
    ~CtypeCLocale();
    CtypeCLocale(const CtypeCLocale &) = delete;
    CtypeCLocale &operator=(const CtypeCLocale &) = delete;

  private:
    void *previous_ = nullptr;   // locale_t on POSIX
};
}  // namespace sk
