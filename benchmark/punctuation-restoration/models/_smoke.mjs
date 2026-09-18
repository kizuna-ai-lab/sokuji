// Harness smoke test, not a punctuator: loads the 7.5 MB sherpa English model and
// runs one dummy batch per call, returning the input unchanged. Proves file
// serving, the EP and the memory sampling before the real ports exist.
export const info = {
  id: '_smoke',
  name: 'harness smoke test',
  langs: ['en'],
  output: 'punct',
  localDir: '/home/jiangzhuo/.cache/sokuji-punct-bench/sherpa/sherpa-onnx-online-punct-en-2024-08-06',
  files: ['model.int8.onnx'],
};

export async function create({ ort, readFile, executionProviders, sessionOptions }) {
  const session = await ort.InferenceSession.create(await readFile('model.int8.onnx'), { executionProviders, ...sessionOptions });
  const T = 200;
  return {
    async punctuate(text) {
      const ids = new Int32Array(T);
      const valid = new Int32Array(T);
      ids[0] = 1; valid[0] = 1; ids[1] = 5; valid[1] = 1; ids[2] = 2; valid[2] = 1;
      await session.run({
        token_ids: new ort.Tensor('int32', ids, [1, T]),
        valid_ids: new ort.Tensor('int32', valid, [1, T]),
        label_lens: new ort.Tensor('int32', Int32Array.from([3]), [1]),
      });
      return text;
    },
    async release() { await session.release(); },
  };
}
