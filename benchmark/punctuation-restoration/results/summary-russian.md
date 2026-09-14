## Offline quality (one call per utterance)

Sentence-boundary F1 excludes the end of the utterance. `stripped` = all marks removed; `raw` = GPT-Live's own transcript; `lower` = English lowercased.

| Model | ru boundary F1 (P/R) | zh raw boundary F1 | en raw boundary F1 | en lower casing F1 |
|---|---|---|---|---|
| Intl.Segmenter | – | **37.9** (100.0/23.4) | **73.7** (100.0/58.3) | – |
| pcs47 | **31.6** (60.0/21.4) | – | – | – |
| sat-3l-sm | **96.6** (93.3/100.0) | – | – | – |

## Offline breakpoints (a comma or a sentence end at the same position)

Where a subtitle line may be cut. Chinese uses comma vs period loosely, so this is the fairer zh measure.

| Model | ru breakpoint F1 (P/R) | zh raw breakpoint F1 |
|---|---|---|
| pcs47 | **88.0** (88.0/88.0) | – |
| sat-3l-sm | **75.0** (100.0/60.0) | – |

## Offline punctuation marks (stripped input)

| Model | lang | comma F1 | period F1 | question F1 | final terminator | ms per call |
|---|---|---|---|---|---|---|
| pcs47 | ru | 64.5 | 64.3 | 66.7 | 100.0% | 76 |

## Streaming commits: sentence ends (model re-run on every chunk; committed after R characters of right context)

| Model | lang | R=0 P/R | R=4 P/R | R=8 P/R | R=16 P/R | mean lag at R=8 (chars) |
|---|---|---|---|---|---|---|
| pcs47 | ru | 66.7/42.9 | 66.7/42.9 | 66.7/42.9 | 66.7/42.9 | 17.3 |
| sat-3l-sm | ru | 71.4/71.4 | 71.4/71.4 | 71.4/71.4 | 71.4/71.4 | 15.8 |

## Streaming commits: breakpoints (any mark) (model re-run on every chunk; committed after R characters of right context)

| Model | lang | R=0 P/R | R=4 P/R | R=8 P/R | R=16 P/R | mean lag at R=8 (chars) |
|---|---|---|---|---|---|---|
| pcs47 | ru | 85.7/96.0 | 85.7/96.0 | 85.7/96.0 | 85.2/92.0 | 13.5 |
| sat-3l-sm | ru | 85.7/48.0 | 85.7/48.0 | 85.7/48.0 | 85.7/48.0 | 16.5 |

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
