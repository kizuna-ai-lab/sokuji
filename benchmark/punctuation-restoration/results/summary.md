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

## Streaming commits (model re-run on every chunk; boundary committed after R characters of right context)

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
