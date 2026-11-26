"""native/node/third_party/ is on the addon's include path (-I / -isystem), where `#include <version>`
and friends are searched first. On a case-insensitive file system (macOS, Windows) a vendored file
called VERSION, Array, Map... IS the standard header's name: node-addon-api's VERSION file broke
both mac builds that way ("unknown type name 'node'" at version:1:1). No file under the vendored
tree may have an extension-less name that matches a C++ (or C) standard header, in any case.
"""
import pathlib

THIRD_PARTY = pathlib.Path(__file__).resolve().parent.parent / "node" / "third_party"

STD_HEADERS = {
    # C++
    "algorithm", "any", "array", "atomic", "barrier", "bit", "bitset", "charconv", "chrono",
    "codecvt", "compare", "complex", "concepts", "condition_variable", "coroutine", "deque",
    "exception", "execution", "expected", "filesystem", "format", "forward_list", "fstream",
    "functional", "future", "generator", "initializer_list", "iomanip", "ios", "iosfwd", "iostream",
    "istream", "iterator", "latch", "limits", "list", "locale", "map", "mdspan", "memory",
    "memory_resource", "mutex", "new", "numbers", "numeric", "optional", "ostream", "print",
    "queue", "random", "ranges", "ratio", "regex", "scoped_allocator", "semaphore", "set",
    "shared_mutex", "source_location", "span", "spanstream", "sstream", "stack", "stacktrace",
    "stdexcept", "stdfloat", "stop_token", "streambuf", "string", "string_view", "strstream",
    "syncstream", "system_error", "thread", "tuple", "type_traits", "typeindex", "typeinfo",
    "unordered_map", "unordered_set", "utility", "valarray", "variant", "vector", "version",
    # C
    "assert", "complex", "ctype", "errno", "fenv", "float", "inttypes", "iso646", "limits",
    "locale", "math", "setjmp", "signal", "stdalign", "stdarg", "stdatomic", "stdbool", "stddef",
    "stdint", "stdio", "stdlib", "stdnoreturn", "string", "tgmath", "threads", "time", "uchar",
    "wchar", "wctype",
}


def test_vendored_tree_exists():
    assert THIRD_PARTY.is_dir()


def test_no_vendored_file_is_named_like_a_standard_header():
    clash = sorted(str(p.relative_to(THIRD_PARTY)) for p in THIRD_PARTY.rglob("*")
                   if p.is_file() and p.name.lower() in STD_HEADERS)
    assert clash == [], f"named like a standard header (breaks case-insensitive include paths): {clash}"
