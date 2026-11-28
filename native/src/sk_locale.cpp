#include "sk_locale.h"

#if !defined(_WIN32)
#  include <locale.h>
#  if defined(__APPLE__)
#    include <xlocale.h>
#  endif
#endif

namespace sk {

#if defined(_WIN32)
CtypeCLocale::CtypeCLocale() = default;
CtypeCLocale::~CtypeCLocale() = default;
#else
namespace {
/* One "C" LC_CTYPE locale object for the whole process, made on first use and never freed (a
 * locale_t may be in use on several threads at once; freeing it at exit would race them). */
locale_t c_ctype() {
    static locale_t c = newlocale(LC_CTYPE_MASK, "C", static_cast<locale_t>(nullptr));
    return c;
}
}  // namespace

CtypeCLocale::CtypeCLocale() {
    if (locale_t c = c_ctype()) previous_ = uselocale(c);   // the thread's own locale, or LC_GLOBAL_LOCALE
}

CtypeCLocale::~CtypeCLocale() {
    if (previous_) uselocale(static_cast<locale_t>(previous_));
}
#endif

}  // namespace sk
