## Offline quality (one call per utterance)

Sentence-boundary F1 excludes the end of the utterance. `stripped` = all marks removed; `raw` = GPT-Live's own transcript; `lower` = English lowercased.

| Model | ja boundary F1 (P/R) | zh boundary F1 (P/R) | en boundary F1 (P/R) | ko boundary F1 (P/R) | zh raw boundary F1 | en raw boundary F1 | en lower casing F1 |
|---|---|---|---|---|---|---|---|
| Intl.Segmenter | **0.0** (0.0/0.0) | **0.0** (0.0/0.0) | **0.0** (0.0/0.0) | **0.0** (0.0/0.0) | **37.9** (100.0/23.4) | **73.7** (100.0/58.3) | – |
| ct-transformer | – | **57.6** (72.3/47.9) | **58.5** (65.5/52.8) | – | **61.7** (73.5/53.2) | **66.7** (77.8/58.3) | 0.0 |
| edge-punct-en | – | – | **84.5** (85.7/83.3) | – | – | **96.0** (92.3/100.0) | 84.0 |
| fireredpunc-q8w | – | **55.4** (93.3/39.4) | **85.7** (88.2/83.3) | – | **60.9** (95.5/44.7) | **96.0** (92.3/100.0) | 78.4 |
| koen-punct | – | – | **50.0** (100.0/33.3) | **76.9** (100.0/62.5) | – | **73.7** (100.0/58.3) | 0.0 |
| mojicast | **87.8** (90.0/85.7) | – | – | – | – | – | – |
| pcs47-sbd | **89.4** (88.4/90.5) | **53.2** (54.4/52.1) | **77.1** (79.4/75.0) | **73.7** (100.0/58.3) | **59.6** (50.7/72.3) | **83.3** (83.3/83.3) | 88.6 |
| fireredpunc | – | **2.8** (100.0/1.4) | **10.5** (100.0/5.6) | – | **4.2** (100.0/2.1) | **28.6** (100.0/16.7) | 51.7 |
| pcs47 | **90.2** (92.5/88.1) | **55.0** (60.0/50.7) | **78.9** (80.0/77.8) | **73.7** (100.0/58.3) | **64.1** (58.9/70.2) | **83.3** (83.3/83.3) | 88.6 |
| sat-3l-sm | **94.1** (93.0/95.2) | **56.2** (68.0/47.9) | **98.6** (97.3/100.0) | **90.9** (100.0/83.3) | **69.0** (75.0/63.8) | **100.0** (100.0/100.0) | 0.0 |
| pcs47-q8w-gather | **87.5** (92.1/83.3) | **55.0** (67.3/46.5) | **81.7** (82.9/80.6) | **73.7** (100.0/58.3) | **63.0** (64.4/61.7) | **88.0** (84.6/91.7) | 91.1 |
| sat-3l-sm-q8w-gather | **94.1** (93.0/95.2) | **57.4** (68.6/49.3) | **98.6** (97.3/100.0) | **90.9** (100.0/83.3) | **70.5** (75.6/66.0) | **100.0** (100.0/100.0) | 0.0 |
| mojicast-q8w-nonan | **87.8** (90.0/85.7) | – | – | – | – | – | – |

## Offline breakpoints (a comma or a sentence end at the same position)

Where a subtitle line may be cut. Chinese uses comma vs period loosely, so this is the fairer zh measure.

| Model | ja breakpoint F1 (P/R) | zh breakpoint F1 (P/R) | en breakpoint F1 (P/R) | ko breakpoint F1 (P/R) | zh raw breakpoint F1 |
|---|---|---|---|---|---|
| ct-transformer | – | **81.3** (86.5/76.7) | **75.9** (81.3/71.2) | – | **79.7** (88.1/72.7) |
| edge-punct-en | – | – | **92.3** (94.3/90.4) | – | – |
| fireredpunc-q8w | – | **91.5** (97.1/86.5) | **85.0** (100.0/74.0) | – | **90.8** (96.1/86.0) |
| koen-punct | – | – | **53.8** (90.3/38.4) | **64.0** (100.0/47.1) | – |
| mojicast | **72.3** (97.7/57.3) | – | – | – | – |
| pcs47-sbd | **67.8** (93.0/53.3) | **41.4** (79.4/28.0) | **57.9** (91.2/42.5) | **58.3** (100.0/41.2) | **47.6** (74.6/35.0) |
| fireredpunc | – | **90.3** (97.0/84.5) | **83.5** (98.1/72.6) | – | **87.9** (95.9/81.1) |
| pcs47 | **85.1** (74.7/98.7) | **83.9** (78.4/90.2) | **84.3** (88.1/80.8) | **88.9** (96.6/82.4) | **82.8** (77.1/89.5) |
| sat-3l-sm | **72.9** (100.0/57.3) | **37.0** (90.0/23.3) | **67.3** (100.0/50.7) | **74.1** (100.0/58.8) | **37.2** (85.0/23.8) |
| pcs47-q8w-gather | **82.3** (72.0/96.0) | **88.2** (82.4/94.8) | **84.5** (87.0/82.2) | **90.6** (96.7/85.3) | **88.2** (83.2/93.7) |
| sat-3l-sm-q8w-gather | **72.9** (100.0/57.3) | **37.7** (90.2/23.8) | **67.3** (100.0/50.7) | **74.1** (100.0/58.8) | **38.0** (85.4/24.5) |
| mojicast-q8w-nonan | **72.3** (97.7/57.3) | – | – | – | – |

## Offline punctuation marks (stripped input)

| Model | lang | comma F1 | period F1 | question F1 | final terminator | ms per call |
|---|---|---|---|---|---|---|
| ct-transformer | zh | 65.9 | 70.7 | 77.8 | 100.0% | 27 |
| ct-transformer | en | 66.7 | 75.0 | 54.5 | 100.0% | 8 |
| edge-punct-en | en | 83.3 | 76.9 | 72.7 | 52.2% | 27 |
| fireredpunc-q8w | zh | 75.8 | 65.7 | 88.9 | 100.0% | 319 |
| fireredpunc-q8w | en | 63.2 | 88.4 | 83.3 | 100.0% | 228 |
| koen-punct | en | 57.1 | 41.9 | 90.9 | 26.1% | 122 |
| koen-punct | ko | 0.0 | 84.4 | 66.7 | 100.0% | 97 |
| mojicast | ja | 16.2 | 84.7 | 0.0 | 100.0% | 159 |
| fireredpunc | zh | 67.8 | 46.4 | 18.2 | 100.0% | 188 |
| fireredpunc | en | 62.9 | 56.8 | 0.0 | 100.0% | 113 |
| pcs47 | ja | 65.2 | 92.9 | 85.7 | 100.0% | 82 |
| pcs47 | zh | 69.7 | 70.1 | 44.4 | 100.0% | 129 |
| pcs47 | en | 66.7 | 84.0 | 76.9 | 100.0% | 93 |
| pcs47 | ko | 56.0 | 87.5 | 72.7 | 100.0% | 73 |
| pcs47-q8w-gather | ja | 63.2 | 89.9 | 80.0 | 100.0% | 189 |
| pcs47-q8w-gather | zh | 71.9 | 71.4 | 50.0 | 100.0% | 244 |
| pcs47-q8w-gather | en | 67.6 | 86.0 | 76.9 | 100.0% | 201 |
| pcs47-q8w-gather | ko | 53.8 | 87.1 | 83.3 | 95.0% | 176 |
| mojicast-q8w-nonan | ja | 16.2 | 84.7 | 0.0 | 100.0% | 277 |

## Streaming commits: sentence ends (model re-run on every chunk; committed after R characters of right context)

| Model | lang | R=0 P/R | R=4 P/R | R=8 P/R | R=16 P/R | mean lag at R=8 (chars) |
|---|---|---|---|---|---|---|
| ct-transformer | en | 54.8/63.9 | 60.5/63.9 | 63.6/58.3 | 65.6/58.3 | 15.2 |
| ct-transformer | zh | 62.9/62.0 | 69.6/54.9 | 71.7/53.5 | 71.2/52.1 | 12.3 |
| edge-punct-en | en | 71.1/88.9 | 74.4/88.9 | 76.2/88.9 | 78.0/88.9 | 13.1 |
| fireredpunc-q8w | en | 86.1/86.1 | 86.1/86.1 | 86.1/86.1 | 86.1/86.1 | 19.3 |
| fireredpunc-q8w | zh | 79.6/54.9 | 84.8/54.9 | 84.4/53.5 | 90.2/52.1 | 21.9 |
| koen-punct | en | 88.9/44.4 | 94.1/44.4 | 94.1/44.4 | 94.1/44.4 | 10.9 |
| koen-punct | ko | 100.0/79.2 | 100.0/79.2 | 100.0/75.0 | 100.0/66.7 | 10.4 |
| mojicast | ja | 82.6/90.5 | 84.1/88.1 | 84.1/88.1 | 90.2/88.1 | 9.5 |
| pcs47 | en | 74.4/88.9 | 76.2/88.9 | 75.6/86.1 | 75.6/86.1 | 16.6 |
| pcs47 | ja | 79.6/92.9 | 86.7/92.9 | 88.6/92.9 | 88.1/88.1 | 9.2 |
| pcs47 | zh | 38.1/63.4 | 38.6/62.0 | 38.7/57.7 | 38.2/54.9 | 14.0 |
| pcs47 | ko | 94.7/75.0 | 94.7/75.0 | 100.0/66.7 | 100.0/62.5 | 10.8 |
| sat-3l-sm | en | 79.4/75.0 | 79.4/75.0 | 79.4/75.0 | 79.4/75.0 | 12.5 |
| sat-3l-sm | ja | 85.1/95.2 | 90.9/95.2 | 93.0/95.2 | 93.0/95.2 | 8.7 |
| sat-3l-sm | zh | 63.0/64.8 | 68.8/62.0 | 71.7/60.6 | 73.7/59.2 | 13.4 |
| sat-3l-sm | ko | 100.0/91.7 | 100.0/91.7 | 100.0/87.5 | 100.0/83.3 | 10.2 |

## Streaming commits: breakpoints (any mark) (model re-run on every chunk; committed after R characters of right context)

| Model | lang | R=0 P/R | R=4 P/R | R=8 P/R | R=16 P/R | mean lag at R=8 (chars) |
|---|---|---|---|---|---|---|
| ct-transformer | en | 80.3/78.1 | 82.4/76.7 | 82.4/76.7 | 82.4/76.7 | 12.8 |
| ct-transformer | zh | 81.8/83.9 | 84.7/82.9 | 85.5/82.4 | 85.9/81.9 | 9.4 |
| edge-punct-en | en | 87.3/94.5 | 88.5/94.5 | 90.8/94.5 | 90.8/94.5 | 11.7 |
| fireredpunc-q8w | en | 94.8/75.3 | 94.8/75.3 | 94.8/75.3 | 96.5/75.3 | 14.0 |
| fireredpunc-q8w | zh | 91.1/90.7 | 93.1/90.7 | 93.0/90.2 | 95.0/88.6 | 9.3 |
| koen-punct | en | 93.5/58.9 | 95.6/58.9 | 97.7/58.9 | 97.7/57.5 | 11.2 |
| koen-punct | ko | 100.0/55.9 | 100.0/55.9 | 100.0/55.9 | 100.0/50.0 | 10.5 |
| mojicast | ja | 94.0/62.7 | 93.9/61.3 | 93.9/61.3 | 97.8/58.7 | 9.6 |
| pcs47 | en | 85.9/91.8 | 85.7/90.4 | 85.5/89.0 | 85.5/89.0 | 17.7 |
| pcs47 | ja | 65.2/100.0 | 69.2/98.7 | 69.8/98.7 | 70.5/98.7 | 8.8 |
| pcs47 | zh | 62.6/95.3 | 63.2/95.3 | 65.2/95.3 | 67.8/94.8 | 9.7 |
| pcs47 | ko | 90.3/82.4 | 90.3/82.4 | 93.3/82.4 | 93.3/82.4 | 10.3 |
| sat-3l-sm | en | 91.2/42.5 | 91.2/42.5 | 91.2/42.5 | 91.2/42.5 | 12.5 |
| sat-3l-sm | ja | 95.7/60.0 | 100.0/58.7 | 100.0/57.3 | 100.0/57.3 | 9.0 |
| sat-3l-sm | zh | 83.6/31.6 | 84.4/28.0 | 86.7/26.9 | 86.0/25.4 | 13.0 |
| sat-3l-sm | ko | 100.0/64.7 | 100.0/64.7 | 100.0/61.8 | 100.0/58.8 | 10.2 |

## Renderer cost (Electron 40 renderer on this box)

Memory is working set from app.getAppMetrics(); "model MB" = renderer after load minus before load.

| Cell | files MB | load ms | model MB (renderer) | renderer peak MB | GPU proc peak MB | ms @ short | ms @ medium | ms @ long |
|---|---|---|---|---|---|---|---|---|
| edge-punct-en/wasm/t1 | 8 | 698 | 273 | 398 | 181 | en 120: 33 | en 240: 43 | en 960: 118 |
| edge-punct-en/wasm/t4 | 8 | 699 | 250 | 405 | 181 | en 120: 12 | en 240: 15 | en 960: 39 |
| edge-punct-en/webgpu/t1 | 8 | 929 | 257 | 421 | 266 | en 120: 58 | en 240: 70 | en 960: 144 |
| ct-transformer/wasm/t1 | 80 | 1063 | 555 | 780 | 181 | zh 60: 26<br>en 120: 7 | zh 120: 41<br>en 240: 13 | zh 480: 164<br>en 960: 45 |
| ct-transformer/wasm/t4 | 80 | 1074 | 562 | 781 | 181 | zh 60: 15<br>en 120: 4 | zh 120: 24<br>en 240: 8 | zh 480: 92<br>en 960: 27 |
| ct-transformer/webgpu/t1 | 80 | 1325 | 578 | 741 | 303 | zh 60: 350<br>en 120: 244 | zh 120: 621<br>en 240: 346 | zh 480: 2237<br>en 960: 943 |
| mojicast/wasm/t1 | 109 | 1193 | 653 | 808 | 181 | ja 60: 181 | ja 120: 351 | ja 480: 1420 |
| mojicast/wasm/t4 | 109 | 1088 | 656 | 846 | 181 | ja 60: 55 | ja 120: 101 | ja 480: 411 |
| mojicast/webgpu/t1 | 109 | 1943 | 695 | 881 | 302 | ja 60: 402 | ja 120: 573 | ja 480: 1833 |
| fireredpunc-q8w/wasm/t1 | 163 | 1352 | 752 | 961 | 181 | zh 60: 263<br>en 120: 192 | zh 120: 425<br>en 240: 298 | zh 480: 1519<br>en 960: 933 |
| fireredpunc-q8w/wasm/t4 | 163 | 1153 | 752 | 1046 | 182 | zh 60: 73<br>en 120: 56 | zh 120: 115<br>en 240: 81 | zh 480: 394<br>en 960: 246 |
| fireredpunc-q8w/webgpu/t1 | 163 | 1497 | 998 | 1243 | 409 | zh 60: 11<br>en 120: 12 | zh 120: 13<br>en 240: 13 | zh 480: 27<br>en 960: 19 |
| koen-punct/wasm/t1 | 328 | 2182 | 1463 | 1652 | 182 | ko 120: 220<br>en 120: 120 | ko 240: 426<br>en 240: 243 | ko 960: 1777<br>en 960: 846 |
| koen-punct/wasm/t4 | 328 | 1908 | 1467 | 1679 | 182 | ko 120: 65<br>en 120: 36 | ko 240: 123<br>en 240: 72 | ko 960: 490<br>en 960: 236 |
| koen-punct/webgpu/t1 | 328 | 2279 | 1482 | 1732 | 336 | ko 120: 404<br>en 120: 305 | ko 240: 599<br>en 240: 422 | ko 960: 1859<br>en 960: 1015 |
| pcs47/wasm/t1 | 288 | 1964 | 1336 | 1632 | 182 | ja 60: 109<br>zh 60: 111<br>en 120: 90<br>ko 120: 166 | ja 120: 180<br>zh 120: 199<br>en 240: 183<br>ko 240: 324 | ja 480: 707<br>zh 480: 887<br>en 960: 648<br>ko 960: 1353 |
| pcs47/wasm/t4 | 288 | 2218 | 1340 | 1631 | 182 | ja 60: 32<br>zh 60: 33<br>en 120: 27<br>ko 120: 48 | ja 120: 52<br>zh 120: 57<br>en 240: 54<br>ko 240: 91 | ja 480: 196<br>zh 480: 248<br>en 960: 181<br>ko 960: 374 |
| pcs47/webgpu/t1 | 288 | 2135 | 1372 | 1592 | 325 | ja 60: 415<br>zh 60: 355<br>en 120: 326<br>ko 120: 393 | ja 120: 397<br>zh 120: 459<br>en 240: 397<br>ko 240: 562 | ja 480: 922<br>zh 480: 1326<br>en 960: 894<br>ko 960: 1800 |
| sat-3l-sm/wasm/t1 | 437 | 2425 | 1918 | 2125 | 182 | ja 60: 28<br>zh 60: 29<br>en 120: 24<br>ko 120: 44 | ja 120: 46<br>zh 120: 52<br>en 240: 48<br>ko 240: 85 | ja 480: 186<br>zh 480: 220<br>en 960: 171<br>ko 960: 372 |
| sat-3l-sm/wasm/t4 | 437 | 2255 | 1941 | 2098 | 182 | ja 60: 21<br>zh 60: 10<br>en 120: 8<br>ko 120: 14 | ja 120: 35<br>zh 120: 17<br>en 240: 16<br>ko 240: 25 | ja 480: 54<br>zh 480: 63<br>en 960: 48<br>ko 960: 103 |
| sat-3l-sm/webgpu/t1 | | failed: Error: failed to call OrtRun(). ERROR_CODE: 1, ERROR_MESSAGE: Non-zero status code returned while running Gather node. Name:'/roberta/embeddings/position_embeddings/Gather' Status Message: shader_helper.cc:401 GenerateSourceCode Program Gather requires f16 but the device does not support it. | | | | | | |
| mojicast-q8w-nonan/webgpu/t1 | 119 | 1521 | 736 | 897 | 334 | ja 60: 12 | ja 120: 14 | ja 480: 33 |
| mojicast-q8w-nonan/wasm/t4 | 119 | 1187 | 678 | 867 | 182 | ja 60: 75 | ja 120: 119 | ja 480: 421 |
| sat-3l-sm-q8w-gather/webgpu/t1 | 251 | 1841 | 1476 | 1621 | 514 | ja 60: 14<br>zh 60: 12<br>en 120: 14<br>ko 120: 12 | ja 120: 16<br>zh 120: 11<br>en 240: 14<br>ko 240: 12 | ja 480: 15<br>zh 480: 13<br>en 960: 13<br>ko 960: 16 |
| sat-3l-sm-q8w-gather/wasm/t4 | | failed: Error: Can't create a session. ERROR_CODE: 9, ERROR_MESSAGE: Could not find an implementation for GatherBlockQuantized(1) node with name '/roberta/embeddings/word_embeddings/Gather_Q8' | | | | | | |
| pcs47-q8w-gather/webgpu/t1 | 325 | 2363 | 1811 | 1954 | 716 | ja 60: 20<br>zh 60: 24<br>en 120: 20<br>ko 120: 35 | ja 120: 35<br>zh 120: 25<br>en 240: 25<br>ko 240: 37 | ja 480: 30<br>zh 480: 74<br>en 960: 25<br>ko 960: 68 |
| pcs47-q8w-gather/wasm/t4 | | failed: Error: Can't create a session. ERROR_CODE: 9, ERROR_MESSAGE: Could not find an implementation for GatherBlockQuantized(1) node with name '/bert_model/embeddings/word_embeddings/Gather_Q8' | | | | | | |
| pcs47-q8w-gather/wasm/t4/ort.wasm.min.mjs | 325 | 1535 | 1340 | 1495 | 182 | ja 60: 56<br>zh 60: 56<br>en 120: 49<br>ko 120: 70 | ja 120: 75<br>zh 120: 79<br>en 240: 74<br>ko 240: 111 | ja 480: 206<br>zh 480: 279<br>en 960: 193<br>ko 960: 394 |
| sat-3l-sm-q8w-gather/wasm/t4/ort.wasm.min.mjs | 251 | 1629 | 1147 | 1290 | 182 | ja 60: 14<br>zh 60: 14<br>en 120: 13<br>ko 120: 18 | ja 120: 19<br>zh 120: 20<br>en 240: 19<br>ko 240: 28 | ja 480: 54<br>zh 480: 62<br>en 960: 50<br>ko 960: 95 |
