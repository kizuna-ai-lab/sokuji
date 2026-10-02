# Doubao AST 2.0 codec

`protos/` is Volcengine's own `protos.tar.gz`, from the "Protobuf" attachment of the
AST 2.0 API document (https://www.volcengine.com/docs/6561/1756902). `ast2-proto.js` and
`ast2-proto.d.ts` are generated from it; never edit them by hand.

The committed files are reproduced byte for byte only by `protobufjs-cli` **1.2.0** with
`protobufjs` **7.5.x** (the repo's own `protobufjs-cli` 2.x emits a different codec). From
the repository root, with both installed in a scratch directory `$T`:

```bash
npm i --prefix "$T" protobufjs-cli@1.2.0 protobufjs@7.5.4
P=src/providers/volcengine_ast2/proto
"$T/node_modules/.bin/pbjs" -t static-module -w es6 --no-create --no-delimited --no-verify --no-convert \
  -p $P/protos -o $P/ast2-proto.js $P/protos/products/understanding/ast/ast_service.proto
"$T/node_modules/.bin/pbts" -o $P/ast2-proto.d.ts $P/ast2-proto.js
```

Regenerate the current protos first and check `git diff` is empty before changing one.
