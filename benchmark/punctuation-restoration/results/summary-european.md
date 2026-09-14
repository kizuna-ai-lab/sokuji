## Offline quality (one call per utterance)

Sentence-boundary F1 excludes the end of the utterance. `stripped` = all marks removed; `raw` = GPT-Live's own transcript; `lower` = English lowercased.

| Model | fr boundary F1 (P/R) | de boundary F1 (P/R) | es boundary F1 (P/R) | pt boundary F1 (P/R) | zh raw boundary F1 | en raw boundary F1 | en lower casing F1 |
|---|---|---|---|---|---|---|---|
| Intl.Segmenter | **0.0** (0.0/0.0) | **0.0** (0.0/0.0) | **0.0** (0.0/0.0) | **0.0** (0.0/0.0) | **37.9** (100.0/23.4) | **73.7** (100.0/58.3) | – |
| ct-transformer | **0.0** (0.0/0.0) | **13.3** (100.0/7.1) | **0.0** (0.0/0.0) | **12.5** (50.0/7.1) | – | – | – |
| pcs47 | **45.5** (62.5/35.7) | **72.7** (100.0/57.1) | **42.1** (80.0/28.6) | **57.1** (85.7/42.9) | – | – | – |
| sat-3l-sm | **100.0** (100.0/100.0) | **100.0** (100.0/100.0) | **96.6** (93.3/100.0) | **100.0** (100.0/100.0) | – | – | – |

## Offline breakpoints (a comma or a sentence end at the same position)

Where a subtitle line may be cut. Chinese uses comma vs period loosely, so this is the fairer zh measure.

| Model | fr breakpoint F1 (P/R) | de breakpoint F1 (P/R) | es breakpoint F1 (P/R) | pt breakpoint F1 (P/R) | zh raw breakpoint F1 |
|---|---|---|---|---|---|
| ct-transformer | **7.1** (100.0/3.7) | **14.8** (50.0/8.7) | **0.0** (0.0/0.0) | **19.4** (42.9/12.5) | – |
| pcs47 | **89.8** (100.0/81.5) | **95.5** (100.0/91.3) | **88.9** (95.2/83.3) | **80.0** (85.7/75.0) | – |
| sat-3l-sm | **68.3** (100.0/51.9) | **75.7** (100.0/60.9) | **76.9** (100.0/62.5) | **73.7** (100.0/58.3) | – |

## Offline punctuation marks (stripped input)

| Model | lang | comma F1 | period F1 | question F1 | final terminator | ms per call |
|---|---|---|---|---|---|---|
| ct-transformer | fr | 0.0 | 53.8 | 0.0 | 100.0% | 10 |
| ct-transformer | de | 0.0 | 59.3 | 0.0 | 100.0% | 9 |
| ct-transformer | es | 0.0 | 53.8 | 0.0 | 100.0% | 8 |
| ct-transformer | pt | 13.3 | 57.1 | 0.0 | 100.0% | 8 |
| pcs47 | fr | 66.7 | 71.0 | 44.4 | 100.0% | 84 |
| pcs47 | de | 72.7 | 86.7 | 80.0 | 100.0% | 79 |
| pcs47 | es | 61.5 | 61.5 | 72.7 | 100.0% | 75 |
| pcs47 | pt | 66.7 | 69.0 | 60.0 | 100.0% | 75 |

## Streaming commits: sentence ends (model re-run on every chunk; committed after R characters of right context)

| Model | lang | R=0 P/R | R=4 P/R | R=8 P/R | R=16 P/R | mean lag at R=8 (chars) |
|---|---|---|---|---|---|---|
| ct-transformer | fr | –/0.0 | –/0.0 | –/0.0 | –/0.0 | – |
| ct-transformer | de | 50.0/7.1 | 100.0/7.1 | 100.0/7.1 | 100.0/7.1 | 16.0 |
| ct-transformer | es | –/0.0 | –/0.0 | –/0.0 | –/0.0 | – |
| ct-transformer | pt | 25.0/7.1 | 33.3/7.1 | 33.3/7.1 | 33.3/7.1 | 11.0 |
| pcs47 | fr | 66.7/42.9 | 66.7/42.9 | 66.7/42.9 | 66.7/42.9 | 17.7 |
| pcs47 | de | 84.6/78.6 | 84.6/78.6 | 91.7/78.6 | 90.9/71.4 | 20.5 |
| pcs47 | es | 62.5/35.7 | 62.5/35.7 | 71.4/35.7 | 71.4/35.7 | 12.2 |
| pcs47 | pt | 64.3/64.3 | 64.3/64.3 | 75.0/64.3 | 80.0/57.1 | 19.9 |
| sat-3l-sm | fr | 75.0/64.3 | 75.0/64.3 | 75.0/64.3 | 75.0/64.3 | 15.1 |
| sat-3l-sm | de | 76.9/71.4 | 83.3/71.4 | 83.3/71.4 | 83.3/71.4 | 15.5 |
| sat-3l-sm | es | 55.6/35.7 | 55.6/35.7 | 55.6/35.7 | 55.6/35.7 | 17.4 |
| sat-3l-sm | pt | 64.3/64.3 | 64.3/64.3 | 64.3/64.3 | 66.7/57.1 | 18.6 |

## Streaming commits: breakpoints (any mark) (model re-run on every chunk; committed after R characters of right context)

| Model | lang | R=0 P/R | R=4 P/R | R=8 P/R | R=16 P/R | mean lag at R=8 (chars) |
|---|---|---|---|---|---|---|
| ct-transformer | fr | 50.0/3.7 | 50.0/3.7 | 50.0/3.7 | 100.0/3.7 | 22.0 |
| ct-transformer | de | 60.0/13.0 | 60.0/13.0 | 60.0/13.0 | 60.0/13.0 | 18.7 |
| ct-transformer | es | 0.0/0.0 | 0.0/0.0 | 0.0/0.0 | 0.0/0.0 | – |
| ct-transformer | pt | 33.3/16.7 | 36.4/16.7 | 36.4/16.7 | 33.3/12.5 | 17.5 |
| pcs47 | fr | 96.0/88.9 | 96.0/88.9 | 100.0/88.9 | 100.0/85.2 | 12.9 |
| pcs47 | de | 95.8/100.0 | 95.8/100.0 | 95.7/95.7 | 95.7/95.7 | 15.7 |
| pcs47 | es | 84.6/91.7 | 84.6/91.7 | 88.0/91.7 | 88.0/91.7 | 13.9 |
| pcs47 | pt | 72.4/87.5 | 75.0/87.5 | 77.8/87.5 | 80.8/87.5 | 14.8 |
| sat-3l-sm | fr | 91.7/40.7 | 91.7/40.7 | 91.7/40.7 | 91.7/40.7 | 14.4 |
| sat-3l-sm | de | 84.6/47.8 | 91.7/47.8 | 91.7/47.8 | 91.7/47.8 | 15.1 |
| sat-3l-sm | es | 88.9/33.3 | 88.9/33.3 | 88.9/33.3 | 88.9/33.3 | 17.8 |
| sat-3l-sm | pt | 78.6/45.8 | 78.6/45.8 | 78.6/45.8 | 75.0/37.5 | 17.8 |

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
