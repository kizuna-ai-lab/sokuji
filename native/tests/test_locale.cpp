// sk::CtypeCLocale (src/sk_locale.h): audio.cpp hands the bytes of UTF-8 text one by one to std::isspace,
// and Apple's libc answers true for 0xA0 / 0x85 under a UTF-8 LC_CTYPE, which breaks e.g. 「你」 (E4 BD A0).
// Inside the guard no byte >= 0x80 is a space; outside it the thread's own classification is back; another
// thread is never affected. Where the platform does not classify any high byte as a space (glibc), the
// "inside" check holds trivially and the test says so; the Apple lane is where it bites.
#undef NDEBUG
#include "sk_locale.h"

#include <cassert>
#include <cctype>
#include <clocale>
#include <cstdio>
#include <thread>
#include <vector>

static std::vector<int> high_spaces() {
    std::vector<int> v;
    for (int b = 0x80; b <= 0xFF; ++b) if (std::isspace(b)) v.push_back(b);
    return v;
}

int main() {
    const char *set = nullptr;
    for (const char *name : {"en_US.UTF-8", "C.UTF-8", "en_US.utf8", "UTF-8"}) {
        if ((set = std::setlocale(LC_ALL, name)) != nullptr) break;
    }
    std::printf("test_locale: process locale %s\n", set ? set : "(no UTF-8 locale available; staying in C)");
    const std::vector<int> before = high_spaces();
    std::printf("test_locale: %zu byte(s) >= 0x80 classify as space outside the guard%s\n", before.size(),
                before.empty() ? " (this platform never does; the inside check is trivial here)" : "");
    {
        sk::CtypeCLocale guard;
#if !defined(_WIN32)
        assert(high_spaces().empty());
#endif
        assert(std::isspace(' ') && std::isspace('\n') && !std::isspace('a'));
        // Per thread: a thread that is not under the guard keeps the process's classification.
        std::vector<int> other;
        std::thread([&] { other = high_spaces(); }).join();
        assert(other == before);
        {
            sk::CtypeCLocale nested;   // entry points can nest (load calls nothing guarded, but stay safe)
            assert(std::isspace(' '));
        }
#if !defined(_WIN32)
        assert(high_spaces().empty());   // the inner guard restored the outer one, not the process's
#endif
    }
    assert(high_spaces() == before);     // restored
    std::printf("test_locale: OK\n");
    return 0;
}
