// Reference piece ids for parity/edge-punct-en: the exact encoder sherpa-onnx links
// (simple-sentencepiece v0.7, ssentencepiece::Ssentencepiece), one word per stdin
// line, ids space-separated on stdout. Build against a v0.7 checkout:
//
//   git clone --depth 1 --branch v0.7 https://github.com/pkufool/simple-sentencepiece <ssp>
//   g++ -O2 -std=c++17 -I<ssp> parity/edge-punct-en-ssentencepiece.cc \
//       <ssp>/ssentencepiece/csrc/ssentencepiece.cc -lpthread -o <out>
//   <out> bpe.vocab < words.txt > ids.txt
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

#include "ssentencepiece/csrc/ssentencepiece.h"

int main(int argc, char **argv) {
  if (argc != 2) {
    std::cerr << "usage: " << argv[0] << " bpe.vocab < words > ids\n";
    return 2;
  }
  std::ifstream is(argv[1]);
  ssentencepiece::Ssentencepiece sp(is, 1);
  std::string line;
  std::vector<int32_t> ids;
  while (std::getline(std::cin, line)) {
    sp.Encode(line, &ids);
    for (size_t i = 0; i < ids.size(); ++i) std::cout << (i ? " " : "") << ids[i];
    std::cout << "\n";
  }
  return 0;
}
