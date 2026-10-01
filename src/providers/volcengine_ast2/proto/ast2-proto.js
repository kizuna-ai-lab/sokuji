/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
import * as $protobuf from "protobufjs/minimal";

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const data = $root.data = (() => {

    /**
     * Namespace data.
     * @exports data
     * @namespace
     */
    const data = {};

    data.speech = (function() {

        /**
         * Namespace speech.
         * @memberof data
         * @namespace
         */
        const speech = {};

        speech.ast = (function() {

            /**
             * Namespace ast.
             * @memberof data.speech
             * @namespace
             */
            const ast = {};

            ast.ReqParams = (function() {

                /**
                 * Properties of a ReqParams.
                 * @memberof data.speech.ast
                 * @interface IReqParams
                 * @property {string|null} [mode] ReqParams mode
                 * @property {string|null} [sourceLanguage] ReqParams sourceLanguage
                 * @property {string|null} [targetLanguage] ReqParams targetLanguage
                 * @property {string|null} [speakerId] ReqParams speakerId
                 * @property {data.speech.understanding.ICorpus|null} [corpus] ReqParams corpus
                 */

                /**
                 * Constructs a new ReqParams.
                 * @memberof data.speech.ast
                 * @classdesc Represents a ReqParams.
                 * @implements IReqParams
                 * @constructor
                 * @param {data.speech.ast.IReqParams=} [properties] Properties to set
                 */
                function ReqParams(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * ReqParams mode.
                 * @member {string} mode
                 * @memberof data.speech.ast.ReqParams
                 * @instance
                 */
                ReqParams.prototype.mode = "";

                /**
                 * ReqParams sourceLanguage.
                 * @member {string} sourceLanguage
                 * @memberof data.speech.ast.ReqParams
                 * @instance
                 */
                ReqParams.prototype.sourceLanguage = "";

                /**
                 * ReqParams targetLanguage.
                 * @member {string} targetLanguage
                 * @memberof data.speech.ast.ReqParams
                 * @instance
                 */
                ReqParams.prototype.targetLanguage = "";

                /**
                 * ReqParams speakerId.
                 * @member {string} speakerId
                 * @memberof data.speech.ast.ReqParams
                 * @instance
                 */
                ReqParams.prototype.speakerId = "";

                /**
                 * ReqParams corpus.
                 * @member {data.speech.understanding.ICorpus|null|undefined} corpus
                 * @memberof data.speech.ast.ReqParams
                 * @instance
                 */
                ReqParams.prototype.corpus = null;

                /**
                 * Encodes the specified ReqParams message. Does not implicitly {@link data.speech.ast.ReqParams.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.ast.ReqParams
                 * @static
                 * @param {data.speech.ast.IReqParams} message ReqParams message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                ReqParams.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.mode != null && Object.hasOwnProperty.call(message, "mode"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.mode);
                    if (message.sourceLanguage != null && Object.hasOwnProperty.call(message, "sourceLanguage"))
                        writer.uint32(/* id 2, wireType 2 =*/18).string(message.sourceLanguage);
                    if (message.targetLanguage != null && Object.hasOwnProperty.call(message, "targetLanguage"))
                        writer.uint32(/* id 3, wireType 2 =*/26).string(message.targetLanguage);
                    if (message.speakerId != null && Object.hasOwnProperty.call(message, "speakerId"))
                        writer.uint32(/* id 4, wireType 2 =*/34).string(message.speakerId);
                    if (message.corpus != null && Object.hasOwnProperty.call(message, "corpus"))
                        $root.data.speech.understanding.Corpus.encode(message.corpus, writer.uint32(/* id 100, wireType 2 =*/802).fork()).ldelim();
                    return writer;
                };

                /**
                 * Decodes a ReqParams message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.ast.ReqParams
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.ast.ReqParams} ReqParams
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                ReqParams.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.ast.ReqParams();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.mode = reader.string();
                                break;
                            }
                        case 2: {
                                message.sourceLanguage = reader.string();
                                break;
                            }
                        case 3: {
                                message.targetLanguage = reader.string();
                                break;
                            }
                        case 4: {
                                message.speakerId = reader.string();
                                break;
                            }
                        case 100: {
                                message.corpus = $root.data.speech.understanding.Corpus.decode(reader, reader.uint32());
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for ReqParams
                 * @function getTypeUrl
                 * @memberof data.speech.ast.ReqParams
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                ReqParams.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.ast.ReqParams";
                };

                return ReqParams;
            })();

            ast.TranslateRequest = (function() {

                /**
                 * Properties of a TranslateRequest.
                 * @memberof data.speech.ast
                 * @interface ITranslateRequest
                 * @property {data.speech.common.IRequestMeta|null} [requestMeta] TranslateRequest requestMeta
                 * @property {data.speech.event.Type|null} [event] TranslateRequest event
                 * @property {data.speech.understanding.IUser|null} [user] TranslateRequest user
                 * @property {data.speech.understanding.IAudio|null} [sourceAudio] TranslateRequest sourceAudio
                 * @property {data.speech.understanding.IAudio|null} [targetAudio] TranslateRequest targetAudio
                 * @property {data.speech.ast.IReqParams|null} [request] TranslateRequest request
                 * @property {boolean|null} [denoise] TranslateRequest denoise
                 */

                /**
                 * Constructs a new TranslateRequest.
                 * @memberof data.speech.ast
                 * @classdesc Represents a TranslateRequest.
                 * @implements ITranslateRequest
                 * @constructor
                 * @param {data.speech.ast.ITranslateRequest=} [properties] Properties to set
                 */
                function TranslateRequest(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * TranslateRequest requestMeta.
                 * @member {data.speech.common.IRequestMeta|null|undefined} requestMeta
                 * @memberof data.speech.ast.TranslateRequest
                 * @instance
                 */
                TranslateRequest.prototype.requestMeta = null;

                /**
                 * TranslateRequest event.
                 * @member {data.speech.event.Type} event
                 * @memberof data.speech.ast.TranslateRequest
                 * @instance
                 */
                TranslateRequest.prototype.event = 0;

                /**
                 * TranslateRequest user.
                 * @member {data.speech.understanding.IUser|null|undefined} user
                 * @memberof data.speech.ast.TranslateRequest
                 * @instance
                 */
                TranslateRequest.prototype.user = null;

                /**
                 * TranslateRequest sourceAudio.
                 * @member {data.speech.understanding.IAudio|null|undefined} sourceAudio
                 * @memberof data.speech.ast.TranslateRequest
                 * @instance
                 */
                TranslateRequest.prototype.sourceAudio = null;

                /**
                 * TranslateRequest targetAudio.
                 * @member {data.speech.understanding.IAudio|null|undefined} targetAudio
                 * @memberof data.speech.ast.TranslateRequest
                 * @instance
                 */
                TranslateRequest.prototype.targetAudio = null;

                /**
                 * TranslateRequest request.
                 * @member {data.speech.ast.IReqParams|null|undefined} request
                 * @memberof data.speech.ast.TranslateRequest
                 * @instance
                 */
                TranslateRequest.prototype.request = null;

                /**
                 * TranslateRequest denoise.
                 * @member {boolean|null|undefined} denoise
                 * @memberof data.speech.ast.TranslateRequest
                 * @instance
                 */
                TranslateRequest.prototype.denoise = null;

                // OneOf field names bound to virtual getters and setters
                let $oneOfFields;

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(TranslateRequest.prototype, "_requestMeta", {
                    get: $util.oneOfGetter($oneOfFields = ["requestMeta"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(TranslateRequest.prototype, "_denoise", {
                    get: $util.oneOfGetter($oneOfFields = ["denoise"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                /**
                 * Encodes the specified TranslateRequest message. Does not implicitly {@link data.speech.ast.TranslateRequest.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.ast.TranslateRequest
                 * @static
                 * @param {data.speech.ast.ITranslateRequest} message TranslateRequest message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                TranslateRequest.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.requestMeta != null && Object.hasOwnProperty.call(message, "requestMeta"))
                        $root.data.speech.common.RequestMeta.encode(message.requestMeta, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
                    if (message.event != null && Object.hasOwnProperty.call(message, "event"))
                        writer.uint32(/* id 2, wireType 0 =*/16).int32(message.event);
                    if (message.user != null && Object.hasOwnProperty.call(message, "user"))
                        $root.data.speech.understanding.User.encode(message.user, writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
                    if (message.sourceAudio != null && Object.hasOwnProperty.call(message, "sourceAudio"))
                        $root.data.speech.understanding.Audio.encode(message.sourceAudio, writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
                    if (message.targetAudio != null && Object.hasOwnProperty.call(message, "targetAudio"))
                        $root.data.speech.understanding.Audio.encode(message.targetAudio, writer.uint32(/* id 5, wireType 2 =*/42).fork()).ldelim();
                    if (message.request != null && Object.hasOwnProperty.call(message, "request"))
                        $root.data.speech.ast.ReqParams.encode(message.request, writer.uint32(/* id 6, wireType 2 =*/50).fork()).ldelim();
                    if (message.denoise != null && Object.hasOwnProperty.call(message, "denoise"))
                        writer.uint32(/* id 7, wireType 0 =*/56).bool(message.denoise);
                    return writer;
                };

                /**
                 * Decodes a TranslateRequest message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.ast.TranslateRequest
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.ast.TranslateRequest} TranslateRequest
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                TranslateRequest.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.ast.TranslateRequest();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.requestMeta = $root.data.speech.common.RequestMeta.decode(reader, reader.uint32());
                                break;
                            }
                        case 2: {
                                message.event = reader.int32();
                                break;
                            }
                        case 3: {
                                message.user = $root.data.speech.understanding.User.decode(reader, reader.uint32());
                                break;
                            }
                        case 4: {
                                message.sourceAudio = $root.data.speech.understanding.Audio.decode(reader, reader.uint32());
                                break;
                            }
                        case 5: {
                                message.targetAudio = $root.data.speech.understanding.Audio.decode(reader, reader.uint32());
                                break;
                            }
                        case 6: {
                                message.request = $root.data.speech.ast.ReqParams.decode(reader, reader.uint32());
                                break;
                            }
                        case 7: {
                                message.denoise = reader.bool();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for TranslateRequest
                 * @function getTypeUrl
                 * @memberof data.speech.ast.TranslateRequest
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                TranslateRequest.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.ast.TranslateRequest";
                };

                return TranslateRequest;
            })();

            ast.TranslateResponse = (function() {

                /**
                 * Properties of a TranslateResponse.
                 * @memberof data.speech.ast
                 * @interface ITranslateResponse
                 * @property {data.speech.common.IResponseMeta|null} [responseMeta] TranslateResponse responseMeta
                 * @property {data.speech.event.Type|null} [event] TranslateResponse event
                 * @property {Uint8Array|null} [data] TranslateResponse data
                 * @property {string|null} [text] TranslateResponse text
                 * @property {number|null} [startTime] TranslateResponse startTime
                 * @property {number|null} [endTime] TranslateResponse endTime
                 * @property {boolean|null} [spkChg] TranslateResponse spkChg
                 * @property {number|null} [mutedDurationMs] TranslateResponse mutedDurationMs
                 */

                /**
                 * Constructs a new TranslateResponse.
                 * @memberof data.speech.ast
                 * @classdesc Represents a TranslateResponse.
                 * @implements ITranslateResponse
                 * @constructor
                 * @param {data.speech.ast.ITranslateResponse=} [properties] Properties to set
                 */
                function TranslateResponse(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * TranslateResponse responseMeta.
                 * @member {data.speech.common.IResponseMeta|null|undefined} responseMeta
                 * @memberof data.speech.ast.TranslateResponse
                 * @instance
                 */
                TranslateResponse.prototype.responseMeta = null;

                /**
                 * TranslateResponse event.
                 * @member {data.speech.event.Type} event
                 * @memberof data.speech.ast.TranslateResponse
                 * @instance
                 */
                TranslateResponse.prototype.event = 0;

                /**
                 * TranslateResponse data.
                 * @member {Uint8Array} data
                 * @memberof data.speech.ast.TranslateResponse
                 * @instance
                 */
                TranslateResponse.prototype.data = $util.newBuffer([]);

                /**
                 * TranslateResponse text.
                 * @member {string} text
                 * @memberof data.speech.ast.TranslateResponse
                 * @instance
                 */
                TranslateResponse.prototype.text = "";

                /**
                 * TranslateResponse startTime.
                 * @member {number} startTime
                 * @memberof data.speech.ast.TranslateResponse
                 * @instance
                 */
                TranslateResponse.prototype.startTime = 0;

                /**
                 * TranslateResponse endTime.
                 * @member {number} endTime
                 * @memberof data.speech.ast.TranslateResponse
                 * @instance
                 */
                TranslateResponse.prototype.endTime = 0;

                /**
                 * TranslateResponse spkChg.
                 * @member {boolean} spkChg
                 * @memberof data.speech.ast.TranslateResponse
                 * @instance
                 */
                TranslateResponse.prototype.spkChg = false;

                /**
                 * TranslateResponse mutedDurationMs.
                 * @member {number} mutedDurationMs
                 * @memberof data.speech.ast.TranslateResponse
                 * @instance
                 */
                TranslateResponse.prototype.mutedDurationMs = 0;

                // OneOf field names bound to virtual getters and setters
                let $oneOfFields;

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(TranslateResponse.prototype, "_responseMeta", {
                    get: $util.oneOfGetter($oneOfFields = ["responseMeta"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                /**
                 * Encodes the specified TranslateResponse message. Does not implicitly {@link data.speech.ast.TranslateResponse.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.ast.TranslateResponse
                 * @static
                 * @param {data.speech.ast.ITranslateResponse} message TranslateResponse message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                TranslateResponse.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.responseMeta != null && Object.hasOwnProperty.call(message, "responseMeta"))
                        $root.data.speech.common.ResponseMeta.encode(message.responseMeta, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
                    if (message.event != null && Object.hasOwnProperty.call(message, "event"))
                        writer.uint32(/* id 2, wireType 0 =*/16).int32(message.event);
                    if (message.data != null && Object.hasOwnProperty.call(message, "data"))
                        writer.uint32(/* id 3, wireType 2 =*/26).bytes(message.data);
                    if (message.text != null && Object.hasOwnProperty.call(message, "text"))
                        writer.uint32(/* id 4, wireType 2 =*/34).string(message.text);
                    if (message.startTime != null && Object.hasOwnProperty.call(message, "startTime"))
                        writer.uint32(/* id 5, wireType 0 =*/40).int32(message.startTime);
                    if (message.endTime != null && Object.hasOwnProperty.call(message, "endTime"))
                        writer.uint32(/* id 6, wireType 0 =*/48).int32(message.endTime);
                    if (message.spkChg != null && Object.hasOwnProperty.call(message, "spkChg"))
                        writer.uint32(/* id 7, wireType 0 =*/56).bool(message.spkChg);
                    if (message.mutedDurationMs != null && Object.hasOwnProperty.call(message, "mutedDurationMs"))
                        writer.uint32(/* id 8, wireType 0 =*/64).int32(message.mutedDurationMs);
                    return writer;
                };

                /**
                 * Decodes a TranslateResponse message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.ast.TranslateResponse
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.ast.TranslateResponse} TranslateResponse
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                TranslateResponse.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.ast.TranslateResponse();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.responseMeta = $root.data.speech.common.ResponseMeta.decode(reader, reader.uint32());
                                break;
                            }
                        case 2: {
                                message.event = reader.int32();
                                break;
                            }
                        case 3: {
                                message.data = reader.bytes();
                                break;
                            }
                        case 4: {
                                message.text = reader.string();
                                break;
                            }
                        case 5: {
                                message.startTime = reader.int32();
                                break;
                            }
                        case 6: {
                                message.endTime = reader.int32();
                                break;
                            }
                        case 7: {
                                message.spkChg = reader.bool();
                                break;
                            }
                        case 8: {
                                message.mutedDurationMs = reader.int32();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for TranslateResponse
                 * @function getTypeUrl
                 * @memberof data.speech.ast.TranslateResponse
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                TranslateResponse.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.ast.TranslateResponse";
                };

                return TranslateResponse;
            })();

            ast.ASTService = (function() {

                /**
                 * Constructs a new ASTService service.
                 * @memberof data.speech.ast
                 * @classdesc Represents a ASTService
                 * @extends $protobuf.rpc.Service
                 * @constructor
                 * @param {$protobuf.RPCImpl} rpcImpl RPC implementation
                 * @param {boolean} [requestDelimited=false] Whether requests are length-delimited
                 * @param {boolean} [responseDelimited=false] Whether responses are length-delimited
                 */
                function ASTService(rpcImpl, requestDelimited, responseDelimited) {
                    $protobuf.rpc.Service.call(this, rpcImpl, requestDelimited, responseDelimited);
                }

                (ASTService.prototype = Object.create($protobuf.rpc.Service.prototype)).constructor = ASTService;

                /**
                 * Callback as used by {@link data.speech.ast.ASTService#translate}.
                 * @memberof data.speech.ast.ASTService
                 * @typedef TranslateCallback
                 * @type {function}
                 * @param {Error|null} error Error, if any
                 * @param {data.speech.ast.TranslateResponse} [response] TranslateResponse
                 */

                /**
                 * Calls Translate.
                 * @function translate
                 * @memberof data.speech.ast.ASTService
                 * @instance
                 * @param {data.speech.ast.ITranslateRequest} request TranslateRequest message or plain object
                 * @param {data.speech.ast.ASTService.TranslateCallback} callback Node-style callback called with the error, if any, and TranslateResponse
                 * @returns {undefined}
                 * @variation 1
                 */
                Object.defineProperty(ASTService.prototype.translate = function translate(request, callback) {
                    return this.rpcCall(translate, $root.data.speech.ast.TranslateRequest, $root.data.speech.ast.TranslateResponse, request, callback);
                }, "name", { value: "Translate" });

                /**
                 * Calls Translate.
                 * @function translate
                 * @memberof data.speech.ast.ASTService
                 * @instance
                 * @param {data.speech.ast.ITranslateRequest} request TranslateRequest message or plain object
                 * @returns {Promise<data.speech.ast.TranslateResponse>} Promise
                 * @variation 2
                 */

                return ASTService;
            })();

            return ast;
        })();

        speech.event = (function() {

            /**
             * Namespace event.
             * @memberof data.speech
             * @namespace
             */
            const event = {};

            /**
             * Type enum.
             * @name data.speech.event.Type
             * @enum {number}
             * @property {number} None=0 None value
             * @property {number} StartConnection=1 StartConnection value
             * @property {number} StartTask=1 StartTask value
             * @property {number} FinishConnection=2 FinishConnection value
             * @property {number} FinishTask=2 FinishTask value
             * @property {number} ConnectionStarted=50 ConnectionStarted value
             * @property {number} TaskStarted=50 TaskStarted value
             * @property {number} ConnectionFailed=51 ConnectionFailed value
             * @property {number} TaskFailed=51 TaskFailed value
             * @property {number} ConnectionFinished=52 ConnectionFinished value
             * @property {number} TaskFinished=52 TaskFinished value
             * @property {number} StartSession=100 StartSession value
             * @property {number} CancelSession=101 CancelSession value
             * @property {number} FinishSession=102 FinishSession value
             * @property {number} SessionStarted=150 SessionStarted value
             * @property {number} SessionCanceled=151 SessionCanceled value
             * @property {number} SessionFinished=152 SessionFinished value
             * @property {number} SessionFailed=153 SessionFailed value
             * @property {number} UsageResponse=154 UsageResponse value
             * @property {number} ChargeData=154 ChargeData value
             * @property {number} TaskRequest=200 TaskRequest value
             * @property {number} UpdateConfig=201 UpdateConfig value
             * @property {number} ImageRequest=202 ImageRequest value
             * @property {number} AudioMuted=250 AudioMuted value
             * @property {number} SayHello=300 SayHello value
             * @property {number} TTSSentenceStart=350 TTSSentenceStart value
             * @property {number} TTSSentenceEnd=351 TTSSentenceEnd value
             * @property {number} TTSResponse=352 TTSResponse value
             * @property {number} TTSEnded=359 TTSEnded value
             * @property {number} PodcastRoundStart=360 PodcastRoundStart value
             * @property {number} PodcastRoundResponse=361 PodcastRoundResponse value
             * @property {number} PodcastRoundEnd=362 PodcastRoundEnd value
             * @property {number} ASRInfo=450 ASRInfo value
             * @property {number} ASRResponse=451 ASRResponse value
             * @property {number} ASREnded=459 ASREnded value
             * @property {number} ChatTTSText=500 ChatTTSText value
             * @property {number} ChatTextQuery=501 ChatTextQuery value
             * @property {number} ChatResponse=550 ChatResponse value
             * @property {number} ChimeInStart=551 ChimeInStart value
             * @property {number} ChimeInEnd=552 ChimeInEnd value
             * @property {number} ChatEnded=559 ChatEnded value
             * @property {number} ThinkStart=560 ThinkStart value
             * @property {number} ThinkResponse=561 ThinkResponse value
             * @property {number} ThinkEnd=562 ThinkEnd value
             * @property {number} ToolOutput=563 ToolOutput value
             * @property {number} FCResponseStart=564 FCResponseStart value
             * @property {number} FCResponse=565 FCResponse value
             * @property {number} FCResponseEnd=566 FCResponseEnd value
             * @property {number} SourceSubtitleStart=650 SourceSubtitleStart value
             * @property {number} SourceSubtitleResponse=651 SourceSubtitleResponse value
             * @property {number} SourceSubtitleEnd=652 SourceSubtitleEnd value
             * @property {number} TranslationSubtitleStart=653 TranslationSubtitleStart value
             * @property {number} TranslationSubtitleResponse=654 TranslationSubtitleResponse value
             * @property {number} TranslationSubtitleEnd=655 TranslationSubtitleEnd value
             */
            event.Type = (function() {
                const valuesById = {}, values = Object.create(valuesById);
                values[valuesById[0] = "None"] = 0;
                values[valuesById[1] = "StartConnection"] = 1;
                values["StartTask"] = 1;
                values[valuesById[2] = "FinishConnection"] = 2;
                values["FinishTask"] = 2;
                values[valuesById[50] = "ConnectionStarted"] = 50;
                values["TaskStarted"] = 50;
                values[valuesById[51] = "ConnectionFailed"] = 51;
                values["TaskFailed"] = 51;
                values[valuesById[52] = "ConnectionFinished"] = 52;
                values["TaskFinished"] = 52;
                values[valuesById[100] = "StartSession"] = 100;
                values[valuesById[101] = "CancelSession"] = 101;
                values[valuesById[102] = "FinishSession"] = 102;
                values[valuesById[150] = "SessionStarted"] = 150;
                values[valuesById[151] = "SessionCanceled"] = 151;
                values[valuesById[152] = "SessionFinished"] = 152;
                values[valuesById[153] = "SessionFailed"] = 153;
                values[valuesById[154] = "UsageResponse"] = 154;
                values["ChargeData"] = 154;
                values[valuesById[200] = "TaskRequest"] = 200;
                values[valuesById[201] = "UpdateConfig"] = 201;
                values[valuesById[202] = "ImageRequest"] = 202;
                values[valuesById[250] = "AudioMuted"] = 250;
                values[valuesById[300] = "SayHello"] = 300;
                values[valuesById[350] = "TTSSentenceStart"] = 350;
                values[valuesById[351] = "TTSSentenceEnd"] = 351;
                values[valuesById[352] = "TTSResponse"] = 352;
                values[valuesById[359] = "TTSEnded"] = 359;
                values[valuesById[360] = "PodcastRoundStart"] = 360;
                values[valuesById[361] = "PodcastRoundResponse"] = 361;
                values[valuesById[362] = "PodcastRoundEnd"] = 362;
                values[valuesById[450] = "ASRInfo"] = 450;
                values[valuesById[451] = "ASRResponse"] = 451;
                values[valuesById[459] = "ASREnded"] = 459;
                values[valuesById[500] = "ChatTTSText"] = 500;
                values[valuesById[501] = "ChatTextQuery"] = 501;
                values[valuesById[550] = "ChatResponse"] = 550;
                values[valuesById[551] = "ChimeInStart"] = 551;
                values[valuesById[552] = "ChimeInEnd"] = 552;
                values[valuesById[559] = "ChatEnded"] = 559;
                values[valuesById[560] = "ThinkStart"] = 560;
                values[valuesById[561] = "ThinkResponse"] = 561;
                values[valuesById[562] = "ThinkEnd"] = 562;
                values[valuesById[563] = "ToolOutput"] = 563;
                values[valuesById[564] = "FCResponseStart"] = 564;
                values[valuesById[565] = "FCResponse"] = 565;
                values[valuesById[566] = "FCResponseEnd"] = 566;
                values[valuesById[650] = "SourceSubtitleStart"] = 650;
                values[valuesById[651] = "SourceSubtitleResponse"] = 651;
                values[valuesById[652] = "SourceSubtitleEnd"] = 652;
                values[valuesById[653] = "TranslationSubtitleStart"] = 653;
                values[valuesById[654] = "TranslationSubtitleResponse"] = 654;
                values[valuesById[655] = "TranslationSubtitleEnd"] = 655;
                return values;
            })();

            return event;
        })();

        speech.common = (function() {

            /**
             * Namespace common.
             * @memberof data.speech
             * @namespace
             */
            const common = {};

            common.RequestMeta = (function() {

                /**
                 * Properties of a RequestMeta.
                 * @memberof data.speech.common
                 * @interface IRequestMeta
                 * @property {string|null} [Endpoint] RequestMeta Endpoint
                 * @property {string|null} [AppKey] RequestMeta AppKey
                 * @property {string|null} [AppID] RequestMeta AppID
                 * @property {string|null} [ResourceID] RequestMeta ResourceID
                 * @property {string|null} [ConnectionID] RequestMeta ConnectionID
                 * @property {string|null} [SessionID] RequestMeta SessionID
                 * @property {number|null} [Sequence] RequestMeta Sequence
                 */

                /**
                 * Constructs a new RequestMeta.
                 * @memberof data.speech.common
                 * @classdesc Represents a RequestMeta.
                 * @implements IRequestMeta
                 * @constructor
                 * @param {data.speech.common.IRequestMeta=} [properties] Properties to set
                 */
                function RequestMeta(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * RequestMeta Endpoint.
                 * @member {string} Endpoint
                 * @memberof data.speech.common.RequestMeta
                 * @instance
                 */
                RequestMeta.prototype.Endpoint = "";

                /**
                 * RequestMeta AppKey.
                 * @member {string} AppKey
                 * @memberof data.speech.common.RequestMeta
                 * @instance
                 */
                RequestMeta.prototype.AppKey = "";

                /**
                 * RequestMeta AppID.
                 * @member {string} AppID
                 * @memberof data.speech.common.RequestMeta
                 * @instance
                 */
                RequestMeta.prototype.AppID = "";

                /**
                 * RequestMeta ResourceID.
                 * @member {string} ResourceID
                 * @memberof data.speech.common.RequestMeta
                 * @instance
                 */
                RequestMeta.prototype.ResourceID = "";

                /**
                 * RequestMeta ConnectionID.
                 * @member {string} ConnectionID
                 * @memberof data.speech.common.RequestMeta
                 * @instance
                 */
                RequestMeta.prototype.ConnectionID = "";

                /**
                 * RequestMeta SessionID.
                 * @member {string} SessionID
                 * @memberof data.speech.common.RequestMeta
                 * @instance
                 */
                RequestMeta.prototype.SessionID = "";

                /**
                 * RequestMeta Sequence.
                 * @member {number} Sequence
                 * @memberof data.speech.common.RequestMeta
                 * @instance
                 */
                RequestMeta.prototype.Sequence = 0;

                /**
                 * Encodes the specified RequestMeta message. Does not implicitly {@link data.speech.common.RequestMeta.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.common.RequestMeta
                 * @static
                 * @param {data.speech.common.IRequestMeta} message RequestMeta message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                RequestMeta.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.Endpoint != null && Object.hasOwnProperty.call(message, "Endpoint"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.Endpoint);
                    if (message.AppKey != null && Object.hasOwnProperty.call(message, "AppKey"))
                        writer.uint32(/* id 2, wireType 2 =*/18).string(message.AppKey);
                    if (message.AppID != null && Object.hasOwnProperty.call(message, "AppID"))
                        writer.uint32(/* id 3, wireType 2 =*/26).string(message.AppID);
                    if (message.ResourceID != null && Object.hasOwnProperty.call(message, "ResourceID"))
                        writer.uint32(/* id 4, wireType 2 =*/34).string(message.ResourceID);
                    if (message.ConnectionID != null && Object.hasOwnProperty.call(message, "ConnectionID"))
                        writer.uint32(/* id 5, wireType 2 =*/42).string(message.ConnectionID);
                    if (message.SessionID != null && Object.hasOwnProperty.call(message, "SessionID"))
                        writer.uint32(/* id 6, wireType 2 =*/50).string(message.SessionID);
                    if (message.Sequence != null && Object.hasOwnProperty.call(message, "Sequence"))
                        writer.uint32(/* id 7, wireType 0 =*/56).int32(message.Sequence);
                    return writer;
                };

                /**
                 * Decodes a RequestMeta message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.common.RequestMeta
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.common.RequestMeta} RequestMeta
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                RequestMeta.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.common.RequestMeta();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.Endpoint = reader.string();
                                break;
                            }
                        case 2: {
                                message.AppKey = reader.string();
                                break;
                            }
                        case 3: {
                                message.AppID = reader.string();
                                break;
                            }
                        case 4: {
                                message.ResourceID = reader.string();
                                break;
                            }
                        case 5: {
                                message.ConnectionID = reader.string();
                                break;
                            }
                        case 6: {
                                message.SessionID = reader.string();
                                break;
                            }
                        case 7: {
                                message.Sequence = reader.int32();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for RequestMeta
                 * @function getTypeUrl
                 * @memberof data.speech.common.RequestMeta
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                RequestMeta.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.common.RequestMeta";
                };

                return RequestMeta;
            })();

            common.BillingItem = (function() {

                /**
                 * Properties of a BillingItem.
                 * @memberof data.speech.common
                 * @interface IBillingItem
                 * @property {string|null} [Unit] BillingItem Unit
                 * @property {number|null} [Quantity] BillingItem Quantity
                 */

                /**
                 * Constructs a new BillingItem.
                 * @memberof data.speech.common
                 * @classdesc Represents a BillingItem.
                 * @implements IBillingItem
                 * @constructor
                 * @param {data.speech.common.IBillingItem=} [properties] Properties to set
                 */
                function BillingItem(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * BillingItem Unit.
                 * @member {string} Unit
                 * @memberof data.speech.common.BillingItem
                 * @instance
                 */
                BillingItem.prototype.Unit = "";

                /**
                 * BillingItem Quantity.
                 * @member {number} Quantity
                 * @memberof data.speech.common.BillingItem
                 * @instance
                 */
                BillingItem.prototype.Quantity = 0;

                /**
                 * Encodes the specified BillingItem message. Does not implicitly {@link data.speech.common.BillingItem.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.common.BillingItem
                 * @static
                 * @param {data.speech.common.IBillingItem} message BillingItem message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                BillingItem.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.Unit != null && Object.hasOwnProperty.call(message, "Unit"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.Unit);
                    if (message.Quantity != null && Object.hasOwnProperty.call(message, "Quantity"))
                        writer.uint32(/* id 2, wireType 5 =*/21).float(message.Quantity);
                    return writer;
                };

                /**
                 * Decodes a BillingItem message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.common.BillingItem
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.common.BillingItem} BillingItem
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                BillingItem.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.common.BillingItem();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.Unit = reader.string();
                                break;
                            }
                        case 2: {
                                message.Quantity = reader.float();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for BillingItem
                 * @function getTypeUrl
                 * @memberof data.speech.common.BillingItem
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                BillingItem.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.common.BillingItem";
                };

                return BillingItem;
            })();

            common.Billing = (function() {

                /**
                 * Properties of a Billing.
                 * @memberof data.speech.common
                 * @interface IBilling
                 * @property {Array.<data.speech.common.IBillingItem>|null} [Items] Billing Items
                 * @property {number|Long|null} [DurationMsec] Billing DurationMsec
                 * @property {number|Long|null} [WordCount] Billing WordCount
                 */

                /**
                 * Constructs a new Billing.
                 * @memberof data.speech.common
                 * @classdesc Represents a Billing.
                 * @implements IBilling
                 * @constructor
                 * @param {data.speech.common.IBilling=} [properties] Properties to set
                 */
                function Billing(properties) {
                    this.Items = [];
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * Billing Items.
                 * @member {Array.<data.speech.common.IBillingItem>} Items
                 * @memberof data.speech.common.Billing
                 * @instance
                 */
                Billing.prototype.Items = $util.emptyArray;

                /**
                 * Billing DurationMsec.
                 * @member {number|Long} DurationMsec
                 * @memberof data.speech.common.Billing
                 * @instance
                 */
                Billing.prototype.DurationMsec = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

                /**
                 * Billing WordCount.
                 * @member {number|Long} WordCount
                 * @memberof data.speech.common.Billing
                 * @instance
                 */
                Billing.prototype.WordCount = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

                /**
                 * Encodes the specified Billing message. Does not implicitly {@link data.speech.common.Billing.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.common.Billing
                 * @static
                 * @param {data.speech.common.IBilling} message Billing message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                Billing.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.Items != null && message.Items.length)
                        for (let i = 0; i < message.Items.length; ++i)
                            $root.data.speech.common.BillingItem.encode(message.Items[i], writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
                    if (message.DurationMsec != null && Object.hasOwnProperty.call(message, "DurationMsec"))
                        writer.uint32(/* id 2, wireType 0 =*/16).int64(message.DurationMsec);
                    if (message.WordCount != null && Object.hasOwnProperty.call(message, "WordCount"))
                        writer.uint32(/* id 3, wireType 0 =*/24).int64(message.WordCount);
                    return writer;
                };

                /**
                 * Decodes a Billing message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.common.Billing
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.common.Billing} Billing
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                Billing.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.common.Billing();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                if (!(message.Items && message.Items.length))
                                    message.Items = [];
                                message.Items.push($root.data.speech.common.BillingItem.decode(reader, reader.uint32()));
                                break;
                            }
                        case 2: {
                                message.DurationMsec = reader.int64();
                                break;
                            }
                        case 3: {
                                message.WordCount = reader.int64();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for Billing
                 * @function getTypeUrl
                 * @memberof data.speech.common.Billing
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                Billing.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.common.Billing";
                };

                return Billing;
            })();

            common.ResponseMeta = (function() {

                /**
                 * Properties of a ResponseMeta.
                 * @memberof data.speech.common
                 * @interface IResponseMeta
                 * @property {string|null} [SessionID] ResponseMeta SessionID
                 * @property {number|null} [Sequence] ResponseMeta Sequence
                 * @property {number|null} [StatusCode] ResponseMeta StatusCode
                 * @property {string|null} [Message] ResponseMeta Message
                 * @property {data.speech.common.IBilling|null} [Billing] ResponseMeta Billing
                 */

                /**
                 * Constructs a new ResponseMeta.
                 * @memberof data.speech.common
                 * @classdesc Represents a ResponseMeta.
                 * @implements IResponseMeta
                 * @constructor
                 * @param {data.speech.common.IResponseMeta=} [properties] Properties to set
                 */
                function ResponseMeta(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * ResponseMeta SessionID.
                 * @member {string} SessionID
                 * @memberof data.speech.common.ResponseMeta
                 * @instance
                 */
                ResponseMeta.prototype.SessionID = "";

                /**
                 * ResponseMeta Sequence.
                 * @member {number} Sequence
                 * @memberof data.speech.common.ResponseMeta
                 * @instance
                 */
                ResponseMeta.prototype.Sequence = 0;

                /**
                 * ResponseMeta StatusCode.
                 * @member {number} StatusCode
                 * @memberof data.speech.common.ResponseMeta
                 * @instance
                 */
                ResponseMeta.prototype.StatusCode = 0;

                /**
                 * ResponseMeta Message.
                 * @member {string} Message
                 * @memberof data.speech.common.ResponseMeta
                 * @instance
                 */
                ResponseMeta.prototype.Message = "";

                /**
                 * ResponseMeta Billing.
                 * @member {data.speech.common.IBilling|null|undefined} Billing
                 * @memberof data.speech.common.ResponseMeta
                 * @instance
                 */
                ResponseMeta.prototype.Billing = null;

                // OneOf field names bound to virtual getters and setters
                let $oneOfFields;

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ResponseMeta.prototype, "_Billing", {
                    get: $util.oneOfGetter($oneOfFields = ["Billing"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                /**
                 * Encodes the specified ResponseMeta message. Does not implicitly {@link data.speech.common.ResponseMeta.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.common.ResponseMeta
                 * @static
                 * @param {data.speech.common.IResponseMeta} message ResponseMeta message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                ResponseMeta.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.SessionID != null && Object.hasOwnProperty.call(message, "SessionID"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.SessionID);
                    if (message.Sequence != null && Object.hasOwnProperty.call(message, "Sequence"))
                        writer.uint32(/* id 2, wireType 0 =*/16).int32(message.Sequence);
                    if (message.StatusCode != null && Object.hasOwnProperty.call(message, "StatusCode"))
                        writer.uint32(/* id 3, wireType 0 =*/24).int32(message.StatusCode);
                    if (message.Message != null && Object.hasOwnProperty.call(message, "Message"))
                        writer.uint32(/* id 4, wireType 2 =*/34).string(message.Message);
                    if (message.Billing != null && Object.hasOwnProperty.call(message, "Billing"))
                        $root.data.speech.common.Billing.encode(message.Billing, writer.uint32(/* id 5, wireType 2 =*/42).fork()).ldelim();
                    return writer;
                };

                /**
                 * Decodes a ResponseMeta message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.common.ResponseMeta
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.common.ResponseMeta} ResponseMeta
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                ResponseMeta.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.common.ResponseMeta();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.SessionID = reader.string();
                                break;
                            }
                        case 2: {
                                message.Sequence = reader.int32();
                                break;
                            }
                        case 3: {
                                message.StatusCode = reader.int32();
                                break;
                            }
                        case 4: {
                                message.Message = reader.string();
                                break;
                            }
                        case 5: {
                                message.Billing = $root.data.speech.common.Billing.decode(reader, reader.uint32());
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for ResponseMeta
                 * @function getTypeUrl
                 * @memberof data.speech.common.ResponseMeta
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                ResponseMeta.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.common.ResponseMeta";
                };

                return ResponseMeta;
            })();

            return common;
        })();

        speech.understanding = (function() {

            /**
             * Namespace understanding.
             * @memberof data.speech
             * @namespace
             */
            const understanding = {};

            /**
             * Code enum.
             * @name data.speech.understanding.Code
             * @enum {number}
             * @property {number} ERROR_UNSPECIFIED=0 ERROR_UNSPECIFIED value
             * @property {number} SUCCESS=21000 SUCCESS value
             * @property {number} INVALID_REQUEST=11100 INVALID_REQUEST value
             * @property {number} PERMISSION_DENIED=11200 PERMISSION_DENIED value
             * @property {number} LIMIT_QPS=11301 LIMIT_QPS value
             * @property {number} LIMIT_COUNT=11302 LIMIT_COUNT value
             * @property {number} SERVER_BUSY=11303 SERVER_BUSY value
             * @property {number} INTERRUPTED=21300 INTERRUPTED value
             * @property {number} ERROR_PARAMS=11500 ERROR_PARAMS value
             * @property {number} LONG_AUDIO=11101 LONG_AUDIO value
             * @property {number} LARGE_PACKET=11102 LARGE_PACKET value
             * @property {number} INVALID_FORMAT=11103 INVALID_FORMAT value
             * @property {number} SILENT_AUDIO=11104 SILENT_AUDIO value
             * @property {number} EMPTY_AUDIO=11105 EMPTY_AUDIO value
             * @property {number} AUDIO_DOWNLOAD_FAIL=21701 AUDIO_DOWNLOAD_FAIL value
             * @property {number} TIMEOUT_WAITING=21200 TIMEOUT_WAITING value
             * @property {number} TIMEOUT_PROCESSING=21201 TIMEOUT_PROCESSING value
             * @property {number} ERROR_PROCESSING=21100 ERROR_PROCESSING value
             * @property {number} ERROR_UNKNOWN=29900 ERROR_UNKNOWN value
             */
            understanding.Code = (function() {
                const valuesById = {}, values = Object.create(valuesById);
                values[valuesById[0] = "ERROR_UNSPECIFIED"] = 0;
                values[valuesById[21000] = "SUCCESS"] = 21000;
                values[valuesById[11100] = "INVALID_REQUEST"] = 11100;
                values[valuesById[11200] = "PERMISSION_DENIED"] = 11200;
                values[valuesById[11301] = "LIMIT_QPS"] = 11301;
                values[valuesById[11302] = "LIMIT_COUNT"] = 11302;
                values[valuesById[11303] = "SERVER_BUSY"] = 11303;
                values[valuesById[21300] = "INTERRUPTED"] = 21300;
                values[valuesById[11500] = "ERROR_PARAMS"] = 11500;
                values[valuesById[11101] = "LONG_AUDIO"] = 11101;
                values[valuesById[11102] = "LARGE_PACKET"] = 11102;
                values[valuesById[11103] = "INVALID_FORMAT"] = 11103;
                values[valuesById[11104] = "SILENT_AUDIO"] = 11104;
                values[valuesById[11105] = "EMPTY_AUDIO"] = 11105;
                values[valuesById[21701] = "AUDIO_DOWNLOAD_FAIL"] = 21701;
                values[valuesById[21200] = "TIMEOUT_WAITING"] = 21200;
                values[valuesById[21201] = "TIMEOUT_PROCESSING"] = 21201;
                values[valuesById[21100] = "ERROR_PROCESSING"] = 21100;
                values[valuesById[29900] = "ERROR_UNKNOWN"] = 29900;
                return values;
            })();

            understanding.Word = (function() {

                /**
                 * Properties of a Word.
                 * @memberof data.speech.understanding
                 * @interface IWord
                 * @property {string|null} [text] Word text
                 * @property {number|null} [startTime] Word startTime
                 * @property {number|null} [endTime] Word endTime
                 * @property {number|null} [blankDuration] Word blankDuration
                 * @property {string|null} [pronounce] Word pronounce
                 * @property {number|null} [confidence] Word confidence
                 */

                /**
                 * Constructs a new Word.
                 * @memberof data.speech.understanding
                 * @classdesc Represents a Word.
                 * @implements IWord
                 * @constructor
                 * @param {data.speech.understanding.IWord=} [properties] Properties to set
                 */
                function Word(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * Word text.
                 * @member {string} text
                 * @memberof data.speech.understanding.Word
                 * @instance
                 */
                Word.prototype.text = "";

                /**
                 * Word startTime.
                 * @member {number} startTime
                 * @memberof data.speech.understanding.Word
                 * @instance
                 */
                Word.prototype.startTime = 0;

                /**
                 * Word endTime.
                 * @member {number} endTime
                 * @memberof data.speech.understanding.Word
                 * @instance
                 */
                Word.prototype.endTime = 0;

                /**
                 * Word blankDuration.
                 * @member {number} blankDuration
                 * @memberof data.speech.understanding.Word
                 * @instance
                 */
                Word.prototype.blankDuration = 0;

                /**
                 * Word pronounce.
                 * @member {string} pronounce
                 * @memberof data.speech.understanding.Word
                 * @instance
                 */
                Word.prototype.pronounce = "";

                /**
                 * Word confidence.
                 * @member {number} confidence
                 * @memberof data.speech.understanding.Word
                 * @instance
                 */
                Word.prototype.confidence = 0;

                /**
                 * Encodes the specified Word message. Does not implicitly {@link data.speech.understanding.Word.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.understanding.Word
                 * @static
                 * @param {data.speech.understanding.IWord} message Word message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                Word.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.text != null && Object.hasOwnProperty.call(message, "text"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.text);
                    if (message.startTime != null && Object.hasOwnProperty.call(message, "startTime"))
                        writer.uint32(/* id 2, wireType 0 =*/16).int32(message.startTime);
                    if (message.endTime != null && Object.hasOwnProperty.call(message, "endTime"))
                        writer.uint32(/* id 3, wireType 0 =*/24).int32(message.endTime);
                    if (message.blankDuration != null && Object.hasOwnProperty.call(message, "blankDuration"))
                        writer.uint32(/* id 4, wireType 0 =*/32).int32(message.blankDuration);
                    if (message.pronounce != null && Object.hasOwnProperty.call(message, "pronounce"))
                        writer.uint32(/* id 5, wireType 2 =*/42).string(message.pronounce);
                    if (message.confidence != null && Object.hasOwnProperty.call(message, "confidence"))
                        writer.uint32(/* id 6, wireType 1 =*/49).double(message.confidence);
                    return writer;
                };

                /**
                 * Decodes a Word message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.understanding.Word
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.understanding.Word} Word
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                Word.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.understanding.Word();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.text = reader.string();
                                break;
                            }
                        case 2: {
                                message.startTime = reader.int32();
                                break;
                            }
                        case 3: {
                                message.endTime = reader.int32();
                                break;
                            }
                        case 4: {
                                message.blankDuration = reader.int32();
                                break;
                            }
                        case 5: {
                                message.pronounce = reader.string();
                                break;
                            }
                        case 6: {
                                message.confidence = reader.double();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for Word
                 * @function getTypeUrl
                 * @memberof data.speech.understanding.Word
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                Word.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.understanding.Word";
                };

                return Word;
            })();

            understanding.UtteranceAddition = (function() {

                /**
                 * Properties of an UtteranceAddition.
                 * @memberof data.speech.understanding
                 * @interface IUtteranceAddition
                 */

                /**
                 * Constructs a new UtteranceAddition.
                 * @memberof data.speech.understanding
                 * @classdesc Represents an UtteranceAddition.
                 * @implements IUtteranceAddition
                 * @constructor
                 * @param {data.speech.understanding.IUtteranceAddition=} [properties] Properties to set
                 */
                function UtteranceAddition(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * Encodes the specified UtteranceAddition message. Does not implicitly {@link data.speech.understanding.UtteranceAddition.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.understanding.UtteranceAddition
                 * @static
                 * @param {data.speech.understanding.IUtteranceAddition} message UtteranceAddition message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                UtteranceAddition.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    return writer;
                };

                /**
                 * Decodes an UtteranceAddition message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.understanding.UtteranceAddition
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.understanding.UtteranceAddition} UtteranceAddition
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                UtteranceAddition.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.understanding.UtteranceAddition();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for UtteranceAddition
                 * @function getTypeUrl
                 * @memberof data.speech.understanding.UtteranceAddition
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                UtteranceAddition.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.understanding.UtteranceAddition";
                };

                return UtteranceAddition;
            })();

            understanding.ResultAddition = (function() {

                /**
                 * Properties of a ResultAddition.
                 * @memberof data.speech.understanding
                 * @interface IResultAddition
                 */

                /**
                 * Constructs a new ResultAddition.
                 * @memberof data.speech.understanding
                 * @classdesc Represents a ResultAddition.
                 * @implements IResultAddition
                 * @constructor
                 * @param {data.speech.understanding.IResultAddition=} [properties] Properties to set
                 */
                function ResultAddition(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * Encodes the specified ResultAddition message. Does not implicitly {@link data.speech.understanding.ResultAddition.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.understanding.ResultAddition
                 * @static
                 * @param {data.speech.understanding.IResultAddition} message ResultAddition message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                ResultAddition.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    return writer;
                };

                /**
                 * Decodes a ResultAddition message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.understanding.ResultAddition
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.understanding.ResultAddition} ResultAddition
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                ResultAddition.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.understanding.ResultAddition();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for ResultAddition
                 * @function getTypeUrl
                 * @memberof data.speech.understanding.ResultAddition
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                ResultAddition.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.understanding.ResultAddition";
                };

                return ResultAddition;
            })();

            understanding.Utterance = (function() {

                /**
                 * Properties of an Utterance.
                 * @memberof data.speech.understanding
                 * @interface IUtterance
                 * @property {string|null} [text] Utterance text
                 * @property {number|null} [startTime] Utterance startTime
                 * @property {number|null} [endTime] Utterance endTime
                 * @property {boolean|null} [definite] Utterance definite
                 * @property {Array.<data.speech.understanding.IWord>|null} [words] Utterance words
                 * @property {string|null} [language] Utterance language
                 * @property {number|null} [confidence] Utterance confidence
                 * @property {number|null} [speaker] Utterance speaker
                 * @property {number|null} [channelId] Utterance channelId
                 * @property {Object.<string,string>|null} [additions] Utterance additions
                 */

                /**
                 * Constructs a new Utterance.
                 * @memberof data.speech.understanding
                 * @classdesc Represents an Utterance.
                 * @implements IUtterance
                 * @constructor
                 * @param {data.speech.understanding.IUtterance=} [properties] Properties to set
                 */
                function Utterance(properties) {
                    this.words = [];
                    this.additions = {};
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * Utterance text.
                 * @member {string} text
                 * @memberof data.speech.understanding.Utterance
                 * @instance
                 */
                Utterance.prototype.text = "";

                /**
                 * Utterance startTime.
                 * @member {number} startTime
                 * @memberof data.speech.understanding.Utterance
                 * @instance
                 */
                Utterance.prototype.startTime = 0;

                /**
                 * Utterance endTime.
                 * @member {number} endTime
                 * @memberof data.speech.understanding.Utterance
                 * @instance
                 */
                Utterance.prototype.endTime = 0;

                /**
                 * Utterance definite.
                 * @member {boolean|null|undefined} definite
                 * @memberof data.speech.understanding.Utterance
                 * @instance
                 */
                Utterance.prototype.definite = null;

                /**
                 * Utterance words.
                 * @member {Array.<data.speech.understanding.IWord>} words
                 * @memberof data.speech.understanding.Utterance
                 * @instance
                 */
                Utterance.prototype.words = $util.emptyArray;

                /**
                 * Utterance language.
                 * @member {string} language
                 * @memberof data.speech.understanding.Utterance
                 * @instance
                 */
                Utterance.prototype.language = "";

                /**
                 * Utterance confidence.
                 * @member {number} confidence
                 * @memberof data.speech.understanding.Utterance
                 * @instance
                 */
                Utterance.prototype.confidence = 0;

                /**
                 * Utterance speaker.
                 * @member {number} speaker
                 * @memberof data.speech.understanding.Utterance
                 * @instance
                 */
                Utterance.prototype.speaker = 0;

                /**
                 * Utterance channelId.
                 * @member {number} channelId
                 * @memberof data.speech.understanding.Utterance
                 * @instance
                 */
                Utterance.prototype.channelId = 0;

                /**
                 * Utterance additions.
                 * @member {Object.<string,string>} additions
                 * @memberof data.speech.understanding.Utterance
                 * @instance
                 */
                Utterance.prototype.additions = $util.emptyObject;

                // OneOf field names bound to virtual getters and setters
                let $oneOfFields;

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(Utterance.prototype, "_definite", {
                    get: $util.oneOfGetter($oneOfFields = ["definite"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                /**
                 * Encodes the specified Utterance message. Does not implicitly {@link data.speech.understanding.Utterance.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.understanding.Utterance
                 * @static
                 * @param {data.speech.understanding.IUtterance} message Utterance message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                Utterance.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.text != null && Object.hasOwnProperty.call(message, "text"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.text);
                    if (message.startTime != null && Object.hasOwnProperty.call(message, "startTime"))
                        writer.uint32(/* id 2, wireType 0 =*/16).int32(message.startTime);
                    if (message.endTime != null && Object.hasOwnProperty.call(message, "endTime"))
                        writer.uint32(/* id 3, wireType 0 =*/24).int32(message.endTime);
                    if (message.definite != null && Object.hasOwnProperty.call(message, "definite"))
                        writer.uint32(/* id 4, wireType 0 =*/32).bool(message.definite);
                    if (message.words != null && message.words.length)
                        for (let i = 0; i < message.words.length; ++i)
                            $root.data.speech.understanding.Word.encode(message.words[i], writer.uint32(/* id 5, wireType 2 =*/42).fork()).ldelim();
                    if (message.language != null && Object.hasOwnProperty.call(message, "language"))
                        writer.uint32(/* id 6, wireType 2 =*/50).string(message.language);
                    if (message.confidence != null && Object.hasOwnProperty.call(message, "confidence"))
                        writer.uint32(/* id 7, wireType 1 =*/57).double(message.confidence);
                    if (message.speaker != null && Object.hasOwnProperty.call(message, "speaker"))
                        writer.uint32(/* id 8, wireType 0 =*/64).int32(message.speaker);
                    if (message.channelId != null && Object.hasOwnProperty.call(message, "channelId"))
                        writer.uint32(/* id 9, wireType 0 =*/72).int32(message.channelId);
                    if (message.additions != null && Object.hasOwnProperty.call(message, "additions"))
                        for (let keys = Object.keys(message.additions), i = 0; i < keys.length; ++i)
                            writer.uint32(/* id 100, wireType 2 =*/802).fork().uint32(/* id 1, wireType 2 =*/10).string(keys[i]).uint32(/* id 2, wireType 2 =*/18).string(message.additions[keys[i]]).ldelim();
                    return writer;
                };

                /**
                 * Decodes an Utterance message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.understanding.Utterance
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.understanding.Utterance} Utterance
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                Utterance.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.understanding.Utterance(), key, value;
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.text = reader.string();
                                break;
                            }
                        case 2: {
                                message.startTime = reader.int32();
                                break;
                            }
                        case 3: {
                                message.endTime = reader.int32();
                                break;
                            }
                        case 4: {
                                message.definite = reader.bool();
                                break;
                            }
                        case 5: {
                                if (!(message.words && message.words.length))
                                    message.words = [];
                                message.words.push($root.data.speech.understanding.Word.decode(reader, reader.uint32()));
                                break;
                            }
                        case 6: {
                                message.language = reader.string();
                                break;
                            }
                        case 7: {
                                message.confidence = reader.double();
                                break;
                            }
                        case 8: {
                                message.speaker = reader.int32();
                                break;
                            }
                        case 9: {
                                message.channelId = reader.int32();
                                break;
                            }
                        case 100: {
                                if (message.additions === $util.emptyObject)
                                    message.additions = {};
                                let end2 = reader.uint32() + reader.pos;
                                key = "";
                                value = "";
                                while (reader.pos < end2) {
                                    let tag2 = reader.uint32();
                                    switch (tag2 >>> 3) {
                                    case 1:
                                        key = reader.string();
                                        break;
                                    case 2:
                                        value = reader.string();
                                        break;
                                    default:
                                        reader.skipType(tag2 & 7);
                                        break;
                                    }
                                }
                                message.additions[key] = value;
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for Utterance
                 * @function getTypeUrl
                 * @memberof data.speech.understanding.Utterance
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                Utterance.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.understanding.Utterance";
                };

                return Utterance;
            })();

            understanding.LanguageDetail = (function() {

                /**
                 * Properties of a LanguageDetail.
                 * @memberof data.speech.understanding
                 * @interface ILanguageDetail
                 * @property {number|null} [prob] LanguageDetail prob
                 */

                /**
                 * Constructs a new LanguageDetail.
                 * @memberof data.speech.understanding
                 * @classdesc Represents a LanguageDetail.
                 * @implements ILanguageDetail
                 * @constructor
                 * @param {data.speech.understanding.ILanguageDetail=} [properties] Properties to set
                 */
                function LanguageDetail(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * LanguageDetail prob.
                 * @member {number} prob
                 * @memberof data.speech.understanding.LanguageDetail
                 * @instance
                 */
                LanguageDetail.prototype.prob = 0;

                /**
                 * Encodes the specified LanguageDetail message. Does not implicitly {@link data.speech.understanding.LanguageDetail.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.understanding.LanguageDetail
                 * @static
                 * @param {data.speech.understanding.ILanguageDetail} message LanguageDetail message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                LanguageDetail.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.prob != null && Object.hasOwnProperty.call(message, "prob"))
                        writer.uint32(/* id 1, wireType 1 =*/9).double(message.prob);
                    return writer;
                };

                /**
                 * Decodes a LanguageDetail message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.understanding.LanguageDetail
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.understanding.LanguageDetail} LanguageDetail
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                LanguageDetail.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.understanding.LanguageDetail();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.prob = reader.double();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for LanguageDetail
                 * @function getTypeUrl
                 * @memberof data.speech.understanding.LanguageDetail
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                LanguageDetail.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.understanding.LanguageDetail";
                };

                return LanguageDetail;
            })();

            understanding.Result = (function() {

                /**
                 * Properties of a Result.
                 * @memberof data.speech.understanding
                 * @interface IResult
                 * @property {string|null} [text] Result text
                 * @property {Array.<data.speech.understanding.IUtterance>|null} [utterances] Result utterances
                 * @property {number|null} [confidence] Result confidence
                 * @property {number|null} [globalConfidence] Result globalConfidence
                 * @property {string|null} [language] Result language
                 * @property {Object.<string,data.speech.understanding.ILanguageDetail>|null} [languageDetails] Result languageDetails
                 * @property {boolean|null} [termination] Result termination
                 * @property {number|null} [volume] Result volume
                 * @property {number|null} [speechRate] Result speechRate
                 * @property {string|null} [resultType] Result resultType
                 * @property {string|null} [oriText] Result oriText
                 * @property {boolean|null} [prefetch] Result prefetch
                 * @property {Object.<string,string>|null} [additions] Result additions
                 */

                /**
                 * Constructs a new Result.
                 * @memberof data.speech.understanding
                 * @classdesc Represents a Result.
                 * @implements IResult
                 * @constructor
                 * @param {data.speech.understanding.IResult=} [properties] Properties to set
                 */
                function Result(properties) {
                    this.utterances = [];
                    this.languageDetails = {};
                    this.additions = {};
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * Result text.
                 * @member {string} text
                 * @memberof data.speech.understanding.Result
                 * @instance
                 */
                Result.prototype.text = "";

                /**
                 * Result utterances.
                 * @member {Array.<data.speech.understanding.IUtterance>} utterances
                 * @memberof data.speech.understanding.Result
                 * @instance
                 */
                Result.prototype.utterances = $util.emptyArray;

                /**
                 * Result confidence.
                 * @member {number} confidence
                 * @memberof data.speech.understanding.Result
                 * @instance
                 */
                Result.prototype.confidence = 0;

                /**
                 * Result globalConfidence.
                 * @member {number} globalConfidence
                 * @memberof data.speech.understanding.Result
                 * @instance
                 */
                Result.prototype.globalConfidence = 0;

                /**
                 * Result language.
                 * @member {string} language
                 * @memberof data.speech.understanding.Result
                 * @instance
                 */
                Result.prototype.language = "";

                /**
                 * Result languageDetails.
                 * @member {Object.<string,data.speech.understanding.ILanguageDetail>} languageDetails
                 * @memberof data.speech.understanding.Result
                 * @instance
                 */
                Result.prototype.languageDetails = $util.emptyObject;

                /**
                 * Result termination.
                 * @member {boolean|null|undefined} termination
                 * @memberof data.speech.understanding.Result
                 * @instance
                 */
                Result.prototype.termination = null;

                /**
                 * Result volume.
                 * @member {number} volume
                 * @memberof data.speech.understanding.Result
                 * @instance
                 */
                Result.prototype.volume = 0;

                /**
                 * Result speechRate.
                 * @member {number} speechRate
                 * @memberof data.speech.understanding.Result
                 * @instance
                 */
                Result.prototype.speechRate = 0;

                /**
                 * Result resultType.
                 * @member {string} resultType
                 * @memberof data.speech.understanding.Result
                 * @instance
                 */
                Result.prototype.resultType = "";

                /**
                 * Result oriText.
                 * @member {string} oriText
                 * @memberof data.speech.understanding.Result
                 * @instance
                 */
                Result.prototype.oriText = "";

                /**
                 * Result prefetch.
                 * @member {boolean|null|undefined} prefetch
                 * @memberof data.speech.understanding.Result
                 * @instance
                 */
                Result.prototype.prefetch = null;

                /**
                 * Result additions.
                 * @member {Object.<string,string>} additions
                 * @memberof data.speech.understanding.Result
                 * @instance
                 */
                Result.prototype.additions = $util.emptyObject;

                // OneOf field names bound to virtual getters and setters
                let $oneOfFields;

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(Result.prototype, "_termination", {
                    get: $util.oneOfGetter($oneOfFields = ["termination"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(Result.prototype, "_prefetch", {
                    get: $util.oneOfGetter($oneOfFields = ["prefetch"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                /**
                 * Encodes the specified Result message. Does not implicitly {@link data.speech.understanding.Result.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.understanding.Result
                 * @static
                 * @param {data.speech.understanding.IResult} message Result message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                Result.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.text != null && Object.hasOwnProperty.call(message, "text"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.text);
                    if (message.utterances != null && message.utterances.length)
                        for (let i = 0; i < message.utterances.length; ++i)
                            $root.data.speech.understanding.Utterance.encode(message.utterances[i], writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
                    if (message.confidence != null && Object.hasOwnProperty.call(message, "confidence"))
                        writer.uint32(/* id 3, wireType 1 =*/25).double(message.confidence);
                    if (message.globalConfidence != null && Object.hasOwnProperty.call(message, "globalConfidence"))
                        writer.uint32(/* id 4, wireType 1 =*/33).double(message.globalConfidence);
                    if (message.language != null && Object.hasOwnProperty.call(message, "language"))
                        writer.uint32(/* id 5, wireType 2 =*/42).string(message.language);
                    if (message.languageDetails != null && Object.hasOwnProperty.call(message, "languageDetails"))
                        for (let keys = Object.keys(message.languageDetails), i = 0; i < keys.length; ++i) {
                            writer.uint32(/* id 6, wireType 2 =*/50).fork().uint32(/* id 1, wireType 2 =*/10).string(keys[i]);
                            $root.data.speech.understanding.LanguageDetail.encode(message.languageDetails[keys[i]], writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim().ldelim();
                        }
                    if (message.termination != null && Object.hasOwnProperty.call(message, "termination"))
                        writer.uint32(/* id 7, wireType 0 =*/56).bool(message.termination);
                    if (message.volume != null && Object.hasOwnProperty.call(message, "volume"))
                        writer.uint32(/* id 8, wireType 1 =*/65).double(message.volume);
                    if (message.speechRate != null && Object.hasOwnProperty.call(message, "speechRate"))
                        writer.uint32(/* id 9, wireType 1 =*/73).double(message.speechRate);
                    if (message.resultType != null && Object.hasOwnProperty.call(message, "resultType"))
                        writer.uint32(/* id 10, wireType 2 =*/82).string(message.resultType);
                    if (message.oriText != null && Object.hasOwnProperty.call(message, "oriText"))
                        writer.uint32(/* id 11, wireType 2 =*/90).string(message.oriText);
                    if (message.prefetch != null && Object.hasOwnProperty.call(message, "prefetch"))
                        writer.uint32(/* id 12, wireType 0 =*/96).bool(message.prefetch);
                    if (message.additions != null && Object.hasOwnProperty.call(message, "additions"))
                        for (let keys = Object.keys(message.additions), i = 0; i < keys.length; ++i)
                            writer.uint32(/* id 100, wireType 2 =*/802).fork().uint32(/* id 1, wireType 2 =*/10).string(keys[i]).uint32(/* id 2, wireType 2 =*/18).string(message.additions[keys[i]]).ldelim();
                    return writer;
                };

                /**
                 * Decodes a Result message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.understanding.Result
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.understanding.Result} Result
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                Result.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.understanding.Result(), key, value;
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.text = reader.string();
                                break;
                            }
                        case 2: {
                                if (!(message.utterances && message.utterances.length))
                                    message.utterances = [];
                                message.utterances.push($root.data.speech.understanding.Utterance.decode(reader, reader.uint32()));
                                break;
                            }
                        case 3: {
                                message.confidence = reader.double();
                                break;
                            }
                        case 4: {
                                message.globalConfidence = reader.double();
                                break;
                            }
                        case 5: {
                                message.language = reader.string();
                                break;
                            }
                        case 6: {
                                if (message.languageDetails === $util.emptyObject)
                                    message.languageDetails = {};
                                let end2 = reader.uint32() + reader.pos;
                                key = "";
                                value = null;
                                while (reader.pos < end2) {
                                    let tag2 = reader.uint32();
                                    switch (tag2 >>> 3) {
                                    case 1:
                                        key = reader.string();
                                        break;
                                    case 2:
                                        value = $root.data.speech.understanding.LanguageDetail.decode(reader, reader.uint32());
                                        break;
                                    default:
                                        reader.skipType(tag2 & 7);
                                        break;
                                    }
                                }
                                message.languageDetails[key] = value;
                                break;
                            }
                        case 7: {
                                message.termination = reader.bool();
                                break;
                            }
                        case 8: {
                                message.volume = reader.double();
                                break;
                            }
                        case 9: {
                                message.speechRate = reader.double();
                                break;
                            }
                        case 10: {
                                message.resultType = reader.string();
                                break;
                            }
                        case 11: {
                                message.oriText = reader.string();
                                break;
                            }
                        case 12: {
                                message.prefetch = reader.bool();
                                break;
                            }
                        case 100: {
                                if (message.additions === $util.emptyObject)
                                    message.additions = {};
                                let end2 = reader.uint32() + reader.pos;
                                key = "";
                                value = "";
                                while (reader.pos < end2) {
                                    let tag2 = reader.uint32();
                                    switch (tag2 >>> 3) {
                                    case 1:
                                        key = reader.string();
                                        break;
                                    case 2:
                                        value = reader.string();
                                        break;
                                    default:
                                        reader.skipType(tag2 & 7);
                                        break;
                                    }
                                }
                                message.additions[key] = value;
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for Result
                 * @function getTypeUrl
                 * @memberof data.speech.understanding.Result
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                Result.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.understanding.Result";
                };

                return Result;
            })();

            understanding.AudioInfo = (function() {

                /**
                 * Properties of an AudioInfo.
                 * @memberof data.speech.understanding
                 * @interface IAudioInfo
                 * @property {number|Long|null} [duration] AudioInfo duration
                 * @property {number|null} [speechRate] AudioInfo speechRate
                 */

                /**
                 * Constructs a new AudioInfo.
                 * @memberof data.speech.understanding
                 * @classdesc Represents an AudioInfo.
                 * @implements IAudioInfo
                 * @constructor
                 * @param {data.speech.understanding.IAudioInfo=} [properties] Properties to set
                 */
                function AudioInfo(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * AudioInfo duration.
                 * @member {number|Long} duration
                 * @memberof data.speech.understanding.AudioInfo
                 * @instance
                 */
                AudioInfo.prototype.duration = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

                /**
                 * AudioInfo speechRate.
                 * @member {number} speechRate
                 * @memberof data.speech.understanding.AudioInfo
                 * @instance
                 */
                AudioInfo.prototype.speechRate = 0;

                /**
                 * Encodes the specified AudioInfo message. Does not implicitly {@link data.speech.understanding.AudioInfo.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.understanding.AudioInfo
                 * @static
                 * @param {data.speech.understanding.IAudioInfo} message AudioInfo message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                AudioInfo.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.duration != null && Object.hasOwnProperty.call(message, "duration"))
                        writer.uint32(/* id 1, wireType 0 =*/8).int64(message.duration);
                    if (message.speechRate != null && Object.hasOwnProperty.call(message, "speechRate"))
                        writer.uint32(/* id 2, wireType 1 =*/17).double(message.speechRate);
                    return writer;
                };

                /**
                 * Decodes an AudioInfo message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.understanding.AudioInfo
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.understanding.AudioInfo} AudioInfo
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                AudioInfo.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.understanding.AudioInfo();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.duration = reader.int64();
                                break;
                            }
                        case 2: {
                                message.speechRate = reader.double();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for AudioInfo
                 * @function getTypeUrl
                 * @memberof data.speech.understanding.AudioInfo
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                AudioInfo.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.understanding.AudioInfo";
                };

                return AudioInfo;
            })();

            understanding.App = (function() {

                /**
                 * Properties of an App.
                 * @memberof data.speech.understanding
                 * @interface IApp
                 * @property {string|null} [workFlowName] App workFlowName
                 */

                /**
                 * Constructs a new App.
                 * @memberof data.speech.understanding
                 * @classdesc Represents an App.
                 * @implements IApp
                 * @constructor
                 * @param {data.speech.understanding.IApp=} [properties] Properties to set
                 */
                function App(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * App workFlowName.
                 * @member {string} workFlowName
                 * @memberof data.speech.understanding.App
                 * @instance
                 */
                App.prototype.workFlowName = "";

                /**
                 * Encodes the specified App message. Does not implicitly {@link data.speech.understanding.App.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.understanding.App
                 * @static
                 * @param {data.speech.understanding.IApp} message App message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                App.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.workFlowName != null && Object.hasOwnProperty.call(message, "workFlowName"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.workFlowName);
                    return writer;
                };

                /**
                 * Decodes an App message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.understanding.App
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.understanding.App} App
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                App.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.understanding.App();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.workFlowName = reader.string();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for App
                 * @function getTypeUrl
                 * @memberof data.speech.understanding.App
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                App.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.understanding.App";
                };

                return App;
            })();

            understanding.User = (function() {

                /**
                 * Properties of a User.
                 * @memberof data.speech.understanding
                 * @interface IUser
                 * @property {string|null} [uid] User uid
                 * @property {string|null} [did] User did
                 * @property {string|null} [platform] User platform
                 * @property {string|null} [sdkVersion] User sdkVersion
                 * @property {string|null} [appVersion] User appVersion
                 */

                /**
                 * Constructs a new User.
                 * @memberof data.speech.understanding
                 * @classdesc Represents a User.
                 * @implements IUser
                 * @constructor
                 * @param {data.speech.understanding.IUser=} [properties] Properties to set
                 */
                function User(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * User uid.
                 * @member {string} uid
                 * @memberof data.speech.understanding.User
                 * @instance
                 */
                User.prototype.uid = "";

                /**
                 * User did.
                 * @member {string} did
                 * @memberof data.speech.understanding.User
                 * @instance
                 */
                User.prototype.did = "";

                /**
                 * User platform.
                 * @member {string} platform
                 * @memberof data.speech.understanding.User
                 * @instance
                 */
                User.prototype.platform = "";

                /**
                 * User sdkVersion.
                 * @member {string} sdkVersion
                 * @memberof data.speech.understanding.User
                 * @instance
                 */
                User.prototype.sdkVersion = "";

                /**
                 * User appVersion.
                 * @member {string} appVersion
                 * @memberof data.speech.understanding.User
                 * @instance
                 */
                User.prototype.appVersion = "";

                /**
                 * Encodes the specified User message. Does not implicitly {@link data.speech.understanding.User.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.understanding.User
                 * @static
                 * @param {data.speech.understanding.IUser} message User message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                User.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.uid != null && Object.hasOwnProperty.call(message, "uid"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.uid);
                    if (message.did != null && Object.hasOwnProperty.call(message, "did"))
                        writer.uint32(/* id 2, wireType 2 =*/18).string(message.did);
                    if (message.platform != null && Object.hasOwnProperty.call(message, "platform"))
                        writer.uint32(/* id 3, wireType 2 =*/26).string(message.platform);
                    if (message.sdkVersion != null && Object.hasOwnProperty.call(message, "sdkVersion"))
                        writer.uint32(/* id 4, wireType 2 =*/34).string(message.sdkVersion);
                    if (message.appVersion != null && Object.hasOwnProperty.call(message, "appVersion"))
                        writer.uint32(/* id 5, wireType 2 =*/42).string(message.appVersion);
                    return writer;
                };

                /**
                 * Decodes a User message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.understanding.User
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.understanding.User} User
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                User.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.understanding.User();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.uid = reader.string();
                                break;
                            }
                        case 2: {
                                message.did = reader.string();
                                break;
                            }
                        case 3: {
                                message.platform = reader.string();
                                break;
                            }
                        case 4: {
                                message.sdkVersion = reader.string();
                                break;
                            }
                        case 5: {
                                message.appVersion = reader.string();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for User
                 * @function getTypeUrl
                 * @memberof data.speech.understanding.User
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                User.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.understanding.User";
                };

                return User;
            })();

            understanding.Audio = (function() {

                /**
                 * Properties of an Audio.
                 * @memberof data.speech.understanding
                 * @interface IAudio
                 * @property {string|null} [data] Audio data
                 * @property {string|null} [url] Audio url
                 * @property {string|null} [urlType] Audio urlType
                 * @property {string|null} [format] Audio format
                 * @property {string|null} [codec] Audio codec
                 * @property {string|null} [language] Audio language
                 * @property {number|null} [rate] Audio rate
                 * @property {number|null} [bits] Audio bits
                 * @property {number|null} [channel] Audio channel
                 * @property {string|null} [tosBucket] Audio tosBucket
                 * @property {string|null} [tosAccessKey] Audio tosAccessKey
                 * @property {string|null} [audioTosObject] Audio audioTosObject
                 * @property {string|null} [roleTrn] Audio roleTrn
                 * @property {Uint8Array|null} [binaryData] Audio binaryData
                 */

                /**
                 * Constructs a new Audio.
                 * @memberof data.speech.understanding
                 * @classdesc Represents an Audio.
                 * @implements IAudio
                 * @constructor
                 * @param {data.speech.understanding.IAudio=} [properties] Properties to set
                 */
                function Audio(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * Audio data.
                 * @member {string} data
                 * @memberof data.speech.understanding.Audio
                 * @instance
                 */
                Audio.prototype.data = "";

                /**
                 * Audio url.
                 * @member {string} url
                 * @memberof data.speech.understanding.Audio
                 * @instance
                 */
                Audio.prototype.url = "";

                /**
                 * Audio urlType.
                 * @member {string} urlType
                 * @memberof data.speech.understanding.Audio
                 * @instance
                 */
                Audio.prototype.urlType = "";

                /**
                 * Audio format.
                 * @member {string} format
                 * @memberof data.speech.understanding.Audio
                 * @instance
                 */
                Audio.prototype.format = "";

                /**
                 * Audio codec.
                 * @member {string} codec
                 * @memberof data.speech.understanding.Audio
                 * @instance
                 */
                Audio.prototype.codec = "";

                /**
                 * Audio language.
                 * @member {string} language
                 * @memberof data.speech.understanding.Audio
                 * @instance
                 */
                Audio.prototype.language = "";

                /**
                 * Audio rate.
                 * @member {number} rate
                 * @memberof data.speech.understanding.Audio
                 * @instance
                 */
                Audio.prototype.rate = 0;

                /**
                 * Audio bits.
                 * @member {number} bits
                 * @memberof data.speech.understanding.Audio
                 * @instance
                 */
                Audio.prototype.bits = 0;

                /**
                 * Audio channel.
                 * @member {number} channel
                 * @memberof data.speech.understanding.Audio
                 * @instance
                 */
                Audio.prototype.channel = 0;

                /**
                 * Audio tosBucket.
                 * @member {string} tosBucket
                 * @memberof data.speech.understanding.Audio
                 * @instance
                 */
                Audio.prototype.tosBucket = "";

                /**
                 * Audio tosAccessKey.
                 * @member {string} tosAccessKey
                 * @memberof data.speech.understanding.Audio
                 * @instance
                 */
                Audio.prototype.tosAccessKey = "";

                /**
                 * Audio audioTosObject.
                 * @member {string} audioTosObject
                 * @memberof data.speech.understanding.Audio
                 * @instance
                 */
                Audio.prototype.audioTosObject = "";

                /**
                 * Audio roleTrn.
                 * @member {string} roleTrn
                 * @memberof data.speech.understanding.Audio
                 * @instance
                 */
                Audio.prototype.roleTrn = "";

                /**
                 * Audio binaryData.
                 * @member {Uint8Array} binaryData
                 * @memberof data.speech.understanding.Audio
                 * @instance
                 */
                Audio.prototype.binaryData = $util.newBuffer([]);

                /**
                 * Encodes the specified Audio message. Does not implicitly {@link data.speech.understanding.Audio.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.understanding.Audio
                 * @static
                 * @param {data.speech.understanding.IAudio} message Audio message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                Audio.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.data != null && Object.hasOwnProperty.call(message, "data"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.data);
                    if (message.url != null && Object.hasOwnProperty.call(message, "url"))
                        writer.uint32(/* id 2, wireType 2 =*/18).string(message.url);
                    if (message.urlType != null && Object.hasOwnProperty.call(message, "urlType"))
                        writer.uint32(/* id 3, wireType 2 =*/26).string(message.urlType);
                    if (message.format != null && Object.hasOwnProperty.call(message, "format"))
                        writer.uint32(/* id 4, wireType 2 =*/34).string(message.format);
                    if (message.codec != null && Object.hasOwnProperty.call(message, "codec"))
                        writer.uint32(/* id 5, wireType 2 =*/42).string(message.codec);
                    if (message.language != null && Object.hasOwnProperty.call(message, "language"))
                        writer.uint32(/* id 6, wireType 2 =*/50).string(message.language);
                    if (message.rate != null && Object.hasOwnProperty.call(message, "rate"))
                        writer.uint32(/* id 7, wireType 0 =*/56).int32(message.rate);
                    if (message.bits != null && Object.hasOwnProperty.call(message, "bits"))
                        writer.uint32(/* id 8, wireType 0 =*/64).int32(message.bits);
                    if (message.channel != null && Object.hasOwnProperty.call(message, "channel"))
                        writer.uint32(/* id 9, wireType 0 =*/72).int32(message.channel);
                    if (message.tosBucket != null && Object.hasOwnProperty.call(message, "tosBucket"))
                        writer.uint32(/* id 10, wireType 2 =*/82).string(message.tosBucket);
                    if (message.tosAccessKey != null && Object.hasOwnProperty.call(message, "tosAccessKey"))
                        writer.uint32(/* id 11, wireType 2 =*/90).string(message.tosAccessKey);
                    if (message.audioTosObject != null && Object.hasOwnProperty.call(message, "audioTosObject"))
                        writer.uint32(/* id 12, wireType 2 =*/98).string(message.audioTosObject);
                    if (message.roleTrn != null && Object.hasOwnProperty.call(message, "roleTrn"))
                        writer.uint32(/* id 13, wireType 2 =*/106).string(message.roleTrn);
                    if (message.binaryData != null && Object.hasOwnProperty.call(message, "binaryData"))
                        writer.uint32(/* id 14, wireType 2 =*/114).bytes(message.binaryData);
                    return writer;
                };

                /**
                 * Decodes an Audio message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.understanding.Audio
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.understanding.Audio} Audio
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                Audio.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.understanding.Audio();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.data = reader.string();
                                break;
                            }
                        case 2: {
                                message.url = reader.string();
                                break;
                            }
                        case 3: {
                                message.urlType = reader.string();
                                break;
                            }
                        case 4: {
                                message.format = reader.string();
                                break;
                            }
                        case 5: {
                                message.codec = reader.string();
                                break;
                            }
                        case 6: {
                                message.language = reader.string();
                                break;
                            }
                        case 7: {
                                message.rate = reader.int32();
                                break;
                            }
                        case 8: {
                                message.bits = reader.int32();
                                break;
                            }
                        case 9: {
                                message.channel = reader.int32();
                                break;
                            }
                        case 10: {
                                message.tosBucket = reader.string();
                                break;
                            }
                        case 11: {
                                message.tosAccessKey = reader.string();
                                break;
                            }
                        case 12: {
                                message.audioTosObject = reader.string();
                                break;
                            }
                        case 13: {
                                message.roleTrn = reader.string();
                                break;
                            }
                        case 14: {
                                message.binaryData = reader.bytes();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for Audio
                 * @function getTypeUrl
                 * @memberof data.speech.understanding.Audio
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                Audio.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.understanding.Audio";
                };

                return Audio;
            })();

            /**
             * AsrNotificationCode enum.
             * @name data.speech.understanding.AsrNotificationCode
             * @enum {number}
             * @property {number} NOTIFICATION_UNSPECIFIED=0 NOTIFICATION_UNSPECIFIED value
             * @property {number} DISCONNECT=1000 DISCONNECT value
             */
            understanding.AsrNotificationCode = (function() {
                const valuesById = {}, values = Object.create(valuesById);
                values[valuesById[0] = "NOTIFICATION_UNSPECIFIED"] = 0;
                values[valuesById[1000] = "DISCONNECT"] = 1000;
                return values;
            })();

            understanding.AsrNotification = (function() {

                /**
                 * Properties of an AsrNotification.
                 * @memberof data.speech.understanding
                 * @interface IAsrNotification
                 * @property {data.speech.understanding.AsrNotificationCode|null} [code] AsrNotification code
                 * @property {string|null} [message] AsrNotification message
                 */

                /**
                 * Constructs a new AsrNotification.
                 * @memberof data.speech.understanding
                 * @classdesc Represents an AsrNotification.
                 * @implements IAsrNotification
                 * @constructor
                 * @param {data.speech.understanding.IAsrNotification=} [properties] Properties to set
                 */
                function AsrNotification(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * AsrNotification code.
                 * @member {data.speech.understanding.AsrNotificationCode} code
                 * @memberof data.speech.understanding.AsrNotification
                 * @instance
                 */
                AsrNotification.prototype.code = 0;

                /**
                 * AsrNotification message.
                 * @member {string} message
                 * @memberof data.speech.understanding.AsrNotification
                 * @instance
                 */
                AsrNotification.prototype.message = "";

                /**
                 * Encodes the specified AsrNotification message. Does not implicitly {@link data.speech.understanding.AsrNotification.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.understanding.AsrNotification
                 * @static
                 * @param {data.speech.understanding.IAsrNotification} message AsrNotification message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                AsrNotification.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.code != null && Object.hasOwnProperty.call(message, "code"))
                        writer.uint32(/* id 1, wireType 0 =*/8).int32(message.code);
                    if (message.message != null && Object.hasOwnProperty.call(message, "message"))
                        writer.uint32(/* id 2, wireType 2 =*/18).string(message.message);
                    return writer;
                };

                /**
                 * Decodes an AsrNotification message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.understanding.AsrNotification
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.understanding.AsrNotification} AsrNotification
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                AsrNotification.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.understanding.AsrNotification();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.code = reader.int32();
                                break;
                            }
                        case 2: {
                                message.message = reader.string();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for AsrNotification
                 * @function getTypeUrl
                 * @memberof data.speech.understanding.AsrNotification
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                AsrNotification.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.understanding.AsrNotification";
                };

                return AsrNotification;
            })();

            understanding.ReqParams = (function() {

                /**
                 * Properties of a ReqParams.
                 * @memberof data.speech.understanding
                 * @interface IReqParams
                 * @property {string|null} [modelName] ReqParams modelName
                 * @property {string|null} [configName] ReqParams configName
                 * @property {boolean|null} [enableVad] ReqParams enableVad
                 * @property {boolean|null} [enablePunc] ReqParams enablePunc
                 * @property {boolean|null} [enableItn] ReqParams enableItn
                 * @property {boolean|null} [enableDdc] ReqParams enableDdc
                 * @property {boolean|null} [enableResample] ReqParams enableResample
                 * @property {boolean|null} [vadSignal] ReqParams vadSignal
                 * @property {boolean|null} [enableTranslate] ReqParams enableTranslate
                 * @property {boolean|null} [disableEndPunc] ReqParams disableEndPunc
                 * @property {boolean|null} [enableSpeakerInfo] ReqParams enableSpeakerInfo
                 * @property {boolean|null} [enableChannelSplit] ReqParams enableChannelSplit
                 * @property {string|null} [appLang] ReqParams appLang
                 * @property {string|null} [country] ReqParams country
                 * @property {string|null} [audioType] ReqParams audioType
                 * @property {boolean|null} [enableLid] ReqParams enableLid
                 * @property {number|null} [reco2actNumSpk] ReqParams reco2actNumSpk
                 * @property {number|null} [reco2maxNumSpk] ReqParams reco2maxNumSpk
                 * @property {boolean|null} [enableInterrupt] ReqParams enableInterrupt
                 * @property {boolean|null} [vadSegment] ReqParams vadSegment
                 * @property {boolean|null} [enableOriText] ReqParams enableOriText
                 * @property {boolean|null} [enableNonstream] ReqParams enableNonstream
                 * @property {boolean|null} [showUtterances] ReqParams showUtterances
                 * @property {boolean|null} [showWords] ReqParams showWords
                 * @property {boolean|null} [showDuration] ReqParams showDuration
                 * @property {boolean|null} [showLanguage] ReqParams showLanguage
                 * @property {boolean|null} [showVolume] ReqParams showVolume
                 * @property {boolean|null} [showVolumeV] ReqParams showVolumeV
                 * @property {boolean|null} [showSpeechRate] ReqParams showSpeechRate
                 * @property {boolean|null} [showPrefetch] ReqParams showPrefetch
                 * @property {string|null} [resultType] ReqParams resultType
                 * @property {number|null} [startSilenceTime] ReqParams startSilenceTime
                 * @property {number|null} [endSilenceTime] ReqParams endSilenceTime
                 * @property {number|null} [vadSilenceTime] ReqParams vadSilenceTime
                 * @property {number|null} [minSilenceTime] ReqParams minSilenceTime
                 * @property {string|null} [vadMode] ReqParams vadMode
                 * @property {number|null} [vadSegmentDuration] ReqParams vadSegmentDuration
                 * @property {number|null} [endWindowSize] ReqParams endWindowSize
                 * @property {number|null} [forceToSpeechTime] ReqParams forceToSpeechTime
                 * @property {data.speech.understanding.ICorpus|null} [corpus] ReqParams corpus
                 * @property {data.speech.understanding.IAsrNotification|null} [notification] ReqParams notification
                 * @property {string|null} [sensitiveWordsFilter] ReqParams sensitiveWordsFilter
                 */

                /**
                 * Constructs a new ReqParams.
                 * @memberof data.speech.understanding
                 * @classdesc Represents a ReqParams.
                 * @implements IReqParams
                 * @constructor
                 * @param {data.speech.understanding.IReqParams=} [properties] Properties to set
                 */
                function ReqParams(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * ReqParams modelName.
                 * @member {string} modelName
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.modelName = "";

                /**
                 * ReqParams configName.
                 * @member {string} configName
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.configName = "";

                /**
                 * ReqParams enableVad.
                 * @member {boolean|null|undefined} enableVad
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.enableVad = null;

                /**
                 * ReqParams enablePunc.
                 * @member {boolean|null|undefined} enablePunc
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.enablePunc = null;

                /**
                 * ReqParams enableItn.
                 * @member {boolean|null|undefined} enableItn
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.enableItn = null;

                /**
                 * ReqParams enableDdc.
                 * @member {boolean|null|undefined} enableDdc
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.enableDdc = null;

                /**
                 * ReqParams enableResample.
                 * @member {boolean|null|undefined} enableResample
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.enableResample = null;

                /**
                 * ReqParams vadSignal.
                 * @member {boolean|null|undefined} vadSignal
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.vadSignal = null;

                /**
                 * ReqParams enableTranslate.
                 * @member {boolean|null|undefined} enableTranslate
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.enableTranslate = null;

                /**
                 * ReqParams disableEndPunc.
                 * @member {boolean|null|undefined} disableEndPunc
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.disableEndPunc = null;

                /**
                 * ReqParams enableSpeakerInfo.
                 * @member {boolean|null|undefined} enableSpeakerInfo
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.enableSpeakerInfo = null;

                /**
                 * ReqParams enableChannelSplit.
                 * @member {boolean|null|undefined} enableChannelSplit
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.enableChannelSplit = null;

                /**
                 * ReqParams appLang.
                 * @member {string} appLang
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.appLang = "";

                /**
                 * ReqParams country.
                 * @member {string} country
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.country = "";

                /**
                 * ReqParams audioType.
                 * @member {string} audioType
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.audioType = "";

                /**
                 * ReqParams enableLid.
                 * @member {boolean|null|undefined} enableLid
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.enableLid = null;

                /**
                 * ReqParams reco2actNumSpk.
                 * @member {number} reco2actNumSpk
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.reco2actNumSpk = 0;

                /**
                 * ReqParams reco2maxNumSpk.
                 * @member {number} reco2maxNumSpk
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.reco2maxNumSpk = 0;

                /**
                 * ReqParams enableInterrupt.
                 * @member {boolean|null|undefined} enableInterrupt
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.enableInterrupt = null;

                /**
                 * ReqParams vadSegment.
                 * @member {boolean|null|undefined} vadSegment
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.vadSegment = null;

                /**
                 * ReqParams enableOriText.
                 * @member {boolean|null|undefined} enableOriText
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.enableOriText = null;

                /**
                 * ReqParams enableNonstream.
                 * @member {boolean|null|undefined} enableNonstream
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.enableNonstream = null;

                /**
                 * ReqParams showUtterances.
                 * @member {boolean|null|undefined} showUtterances
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.showUtterances = null;

                /**
                 * ReqParams showWords.
                 * @member {boolean|null|undefined} showWords
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.showWords = null;

                /**
                 * ReqParams showDuration.
                 * @member {boolean|null|undefined} showDuration
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.showDuration = null;

                /**
                 * ReqParams showLanguage.
                 * @member {boolean|null|undefined} showLanguage
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.showLanguage = null;

                /**
                 * ReqParams showVolume.
                 * @member {boolean|null|undefined} showVolume
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.showVolume = null;

                /**
                 * ReqParams showVolumeV.
                 * @member {boolean|null|undefined} showVolumeV
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.showVolumeV = null;

                /**
                 * ReqParams showSpeechRate.
                 * @member {boolean|null|undefined} showSpeechRate
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.showSpeechRate = null;

                /**
                 * ReqParams showPrefetch.
                 * @member {boolean|null|undefined} showPrefetch
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.showPrefetch = null;

                /**
                 * ReqParams resultType.
                 * @member {string} resultType
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.resultType = "";

                /**
                 * ReqParams startSilenceTime.
                 * @member {number} startSilenceTime
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.startSilenceTime = 0;

                /**
                 * ReqParams endSilenceTime.
                 * @member {number} endSilenceTime
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.endSilenceTime = 0;

                /**
                 * ReqParams vadSilenceTime.
                 * @member {number} vadSilenceTime
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.vadSilenceTime = 0;

                /**
                 * ReqParams minSilenceTime.
                 * @member {number} minSilenceTime
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.minSilenceTime = 0;

                /**
                 * ReqParams vadMode.
                 * @member {string} vadMode
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.vadMode = "";

                /**
                 * ReqParams vadSegmentDuration.
                 * @member {number} vadSegmentDuration
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.vadSegmentDuration = 0;

                /**
                 * ReqParams endWindowSize.
                 * @member {number} endWindowSize
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.endWindowSize = 0;

                /**
                 * ReqParams forceToSpeechTime.
                 * @member {number} forceToSpeechTime
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.forceToSpeechTime = 0;

                /**
                 * ReqParams corpus.
                 * @member {data.speech.understanding.ICorpus|null|undefined} corpus
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.corpus = null;

                /**
                 * ReqParams notification.
                 * @member {data.speech.understanding.IAsrNotification|null|undefined} notification
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.notification = null;

                /**
                 * ReqParams sensitiveWordsFilter.
                 * @member {string} sensitiveWordsFilter
                 * @memberof data.speech.understanding.ReqParams
                 * @instance
                 */
                ReqParams.prototype.sensitiveWordsFilter = "";

                // OneOf field names bound to virtual getters and setters
                let $oneOfFields;

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_enableVad", {
                    get: $util.oneOfGetter($oneOfFields = ["enableVad"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_enablePunc", {
                    get: $util.oneOfGetter($oneOfFields = ["enablePunc"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_enableItn", {
                    get: $util.oneOfGetter($oneOfFields = ["enableItn"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_enableDdc", {
                    get: $util.oneOfGetter($oneOfFields = ["enableDdc"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_enableResample", {
                    get: $util.oneOfGetter($oneOfFields = ["enableResample"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_vadSignal", {
                    get: $util.oneOfGetter($oneOfFields = ["vadSignal"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_enableTranslate", {
                    get: $util.oneOfGetter($oneOfFields = ["enableTranslate"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_disableEndPunc", {
                    get: $util.oneOfGetter($oneOfFields = ["disableEndPunc"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_enableSpeakerInfo", {
                    get: $util.oneOfGetter($oneOfFields = ["enableSpeakerInfo"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_enableChannelSplit", {
                    get: $util.oneOfGetter($oneOfFields = ["enableChannelSplit"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_enableLid", {
                    get: $util.oneOfGetter($oneOfFields = ["enableLid"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_enableInterrupt", {
                    get: $util.oneOfGetter($oneOfFields = ["enableInterrupt"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_vadSegment", {
                    get: $util.oneOfGetter($oneOfFields = ["vadSegment"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_enableOriText", {
                    get: $util.oneOfGetter($oneOfFields = ["enableOriText"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_enableNonstream", {
                    get: $util.oneOfGetter($oneOfFields = ["enableNonstream"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_showUtterances", {
                    get: $util.oneOfGetter($oneOfFields = ["showUtterances"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_showWords", {
                    get: $util.oneOfGetter($oneOfFields = ["showWords"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_showDuration", {
                    get: $util.oneOfGetter($oneOfFields = ["showDuration"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_showLanguage", {
                    get: $util.oneOfGetter($oneOfFields = ["showLanguage"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_showVolume", {
                    get: $util.oneOfGetter($oneOfFields = ["showVolume"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_showVolumeV", {
                    get: $util.oneOfGetter($oneOfFields = ["showVolumeV"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_showSpeechRate", {
                    get: $util.oneOfGetter($oneOfFields = ["showSpeechRate"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(ReqParams.prototype, "_showPrefetch", {
                    get: $util.oneOfGetter($oneOfFields = ["showPrefetch"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                /**
                 * Encodes the specified ReqParams message. Does not implicitly {@link data.speech.understanding.ReqParams.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.understanding.ReqParams
                 * @static
                 * @param {data.speech.understanding.IReqParams} message ReqParams message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                ReqParams.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.modelName != null && Object.hasOwnProperty.call(message, "modelName"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.modelName);
                    if (message.configName != null && Object.hasOwnProperty.call(message, "configName"))
                        writer.uint32(/* id 2, wireType 2 =*/18).string(message.configName);
                    if (message.enableVad != null && Object.hasOwnProperty.call(message, "enableVad"))
                        writer.uint32(/* id 3, wireType 0 =*/24).bool(message.enableVad);
                    if (message.enablePunc != null && Object.hasOwnProperty.call(message, "enablePunc"))
                        writer.uint32(/* id 4, wireType 0 =*/32).bool(message.enablePunc);
                    if (message.enableItn != null && Object.hasOwnProperty.call(message, "enableItn"))
                        writer.uint32(/* id 5, wireType 0 =*/40).bool(message.enableItn);
                    if (message.enableDdc != null && Object.hasOwnProperty.call(message, "enableDdc"))
                        writer.uint32(/* id 6, wireType 0 =*/48).bool(message.enableDdc);
                    if (message.enableResample != null && Object.hasOwnProperty.call(message, "enableResample"))
                        writer.uint32(/* id 7, wireType 0 =*/56).bool(message.enableResample);
                    if (message.vadSignal != null && Object.hasOwnProperty.call(message, "vadSignal"))
                        writer.uint32(/* id 8, wireType 0 =*/64).bool(message.vadSignal);
                    if (message.enableTranslate != null && Object.hasOwnProperty.call(message, "enableTranslate"))
                        writer.uint32(/* id 9, wireType 0 =*/72).bool(message.enableTranslate);
                    if (message.disableEndPunc != null && Object.hasOwnProperty.call(message, "disableEndPunc"))
                        writer.uint32(/* id 10, wireType 0 =*/80).bool(message.disableEndPunc);
                    if (message.enableSpeakerInfo != null && Object.hasOwnProperty.call(message, "enableSpeakerInfo"))
                        writer.uint32(/* id 11, wireType 0 =*/88).bool(message.enableSpeakerInfo);
                    if (message.enableChannelSplit != null && Object.hasOwnProperty.call(message, "enableChannelSplit"))
                        writer.uint32(/* id 12, wireType 0 =*/96).bool(message.enableChannelSplit);
                    if (message.appLang != null && Object.hasOwnProperty.call(message, "appLang"))
                        writer.uint32(/* id 13, wireType 2 =*/106).string(message.appLang);
                    if (message.country != null && Object.hasOwnProperty.call(message, "country"))
                        writer.uint32(/* id 14, wireType 2 =*/114).string(message.country);
                    if (message.audioType != null && Object.hasOwnProperty.call(message, "audioType"))
                        writer.uint32(/* id 15, wireType 2 =*/122).string(message.audioType);
                    if (message.enableLid != null && Object.hasOwnProperty.call(message, "enableLid"))
                        writer.uint32(/* id 16, wireType 0 =*/128).bool(message.enableLid);
                    if (message.reco2actNumSpk != null && Object.hasOwnProperty.call(message, "reco2actNumSpk"))
                        writer.uint32(/* id 17, wireType 0 =*/136).int32(message.reco2actNumSpk);
                    if (message.reco2maxNumSpk != null && Object.hasOwnProperty.call(message, "reco2maxNumSpk"))
                        writer.uint32(/* id 18, wireType 0 =*/144).int32(message.reco2maxNumSpk);
                    if (message.enableInterrupt != null && Object.hasOwnProperty.call(message, "enableInterrupt"))
                        writer.uint32(/* id 19, wireType 0 =*/152).bool(message.enableInterrupt);
                    if (message.vadSegment != null && Object.hasOwnProperty.call(message, "vadSegment"))
                        writer.uint32(/* id 20, wireType 0 =*/160).bool(message.vadSegment);
                    if (message.enableOriText != null && Object.hasOwnProperty.call(message, "enableOriText"))
                        writer.uint32(/* id 21, wireType 0 =*/168).bool(message.enableOriText);
                    if (message.enableNonstream != null && Object.hasOwnProperty.call(message, "enableNonstream"))
                        writer.uint32(/* id 22, wireType 0 =*/176).bool(message.enableNonstream);
                    if (message.showUtterances != null && Object.hasOwnProperty.call(message, "showUtterances"))
                        writer.uint32(/* id 31, wireType 0 =*/248).bool(message.showUtterances);
                    if (message.showWords != null && Object.hasOwnProperty.call(message, "showWords"))
                        writer.uint32(/* id 32, wireType 0 =*/256).bool(message.showWords);
                    if (message.showDuration != null && Object.hasOwnProperty.call(message, "showDuration"))
                        writer.uint32(/* id 33, wireType 0 =*/264).bool(message.showDuration);
                    if (message.showLanguage != null && Object.hasOwnProperty.call(message, "showLanguage"))
                        writer.uint32(/* id 34, wireType 0 =*/272).bool(message.showLanguage);
                    if (message.showVolume != null && Object.hasOwnProperty.call(message, "showVolume"))
                        writer.uint32(/* id 35, wireType 0 =*/280).bool(message.showVolume);
                    if (message.showSpeechRate != null && Object.hasOwnProperty.call(message, "showSpeechRate"))
                        writer.uint32(/* id 37, wireType 0 =*/296).bool(message.showSpeechRate);
                    if (message.showPrefetch != null && Object.hasOwnProperty.call(message, "showPrefetch"))
                        writer.uint32(/* id 38, wireType 0 =*/304).bool(message.showPrefetch);
                    if (message.resultType != null && Object.hasOwnProperty.call(message, "resultType"))
                        writer.uint32(/* id 39, wireType 2 =*/314).string(message.resultType);
                    if (message.startSilenceTime != null && Object.hasOwnProperty.call(message, "startSilenceTime"))
                        writer.uint32(/* id 61, wireType 0 =*/488).int32(message.startSilenceTime);
                    if (message.endSilenceTime != null && Object.hasOwnProperty.call(message, "endSilenceTime"))
                        writer.uint32(/* id 62, wireType 0 =*/496).int32(message.endSilenceTime);
                    if (message.vadSilenceTime != null && Object.hasOwnProperty.call(message, "vadSilenceTime"))
                        writer.uint32(/* id 63, wireType 0 =*/504).int32(message.vadSilenceTime);
                    if (message.minSilenceTime != null && Object.hasOwnProperty.call(message, "minSilenceTime"))
                        writer.uint32(/* id 64, wireType 0 =*/512).int32(message.minSilenceTime);
                    if (message.vadMode != null && Object.hasOwnProperty.call(message, "vadMode"))
                        writer.uint32(/* id 65, wireType 2 =*/522).string(message.vadMode);
                    if (message.vadSegmentDuration != null && Object.hasOwnProperty.call(message, "vadSegmentDuration"))
                        writer.uint32(/* id 66, wireType 0 =*/528).int32(message.vadSegmentDuration);
                    if (message.endWindowSize != null && Object.hasOwnProperty.call(message, "endWindowSize"))
                        writer.uint32(/* id 67, wireType 0 =*/536).int32(message.endWindowSize);
                    if (message.forceToSpeechTime != null && Object.hasOwnProperty.call(message, "forceToSpeechTime"))
                        writer.uint32(/* id 68, wireType 0 =*/544).int32(message.forceToSpeechTime);
                    if (message.corpus != null && Object.hasOwnProperty.call(message, "corpus"))
                        $root.data.speech.understanding.Corpus.encode(message.corpus, writer.uint32(/* id 100, wireType 2 =*/802).fork()).ldelim();
                    if (message.notification != null && Object.hasOwnProperty.call(message, "notification"))
                        $root.data.speech.understanding.AsrNotification.encode(message.notification, writer.uint32(/* id 101, wireType 2 =*/810).fork()).ldelim();
                    if (message.sensitiveWordsFilter != null && Object.hasOwnProperty.call(message, "sensitiveWordsFilter"))
                        writer.uint32(/* id 102, wireType 2 =*/818).string(message.sensitiveWordsFilter);
                    if (message.showVolumeV != null && Object.hasOwnProperty.call(message, "showVolumeV"))
                        writer.uint32(/* id 362, wireType 0 =*/2896).bool(message.showVolumeV);
                    return writer;
                };

                /**
                 * Decodes a ReqParams message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.understanding.ReqParams
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.understanding.ReqParams} ReqParams
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                ReqParams.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.understanding.ReqParams();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.modelName = reader.string();
                                break;
                            }
                        case 2: {
                                message.configName = reader.string();
                                break;
                            }
                        case 3: {
                                message.enableVad = reader.bool();
                                break;
                            }
                        case 4: {
                                message.enablePunc = reader.bool();
                                break;
                            }
                        case 5: {
                                message.enableItn = reader.bool();
                                break;
                            }
                        case 6: {
                                message.enableDdc = reader.bool();
                                break;
                            }
                        case 7: {
                                message.enableResample = reader.bool();
                                break;
                            }
                        case 8: {
                                message.vadSignal = reader.bool();
                                break;
                            }
                        case 9: {
                                message.enableTranslate = reader.bool();
                                break;
                            }
                        case 10: {
                                message.disableEndPunc = reader.bool();
                                break;
                            }
                        case 11: {
                                message.enableSpeakerInfo = reader.bool();
                                break;
                            }
                        case 12: {
                                message.enableChannelSplit = reader.bool();
                                break;
                            }
                        case 13: {
                                message.appLang = reader.string();
                                break;
                            }
                        case 14: {
                                message.country = reader.string();
                                break;
                            }
                        case 15: {
                                message.audioType = reader.string();
                                break;
                            }
                        case 16: {
                                message.enableLid = reader.bool();
                                break;
                            }
                        case 17: {
                                message.reco2actNumSpk = reader.int32();
                                break;
                            }
                        case 18: {
                                message.reco2maxNumSpk = reader.int32();
                                break;
                            }
                        case 19: {
                                message.enableInterrupt = reader.bool();
                                break;
                            }
                        case 20: {
                                message.vadSegment = reader.bool();
                                break;
                            }
                        case 21: {
                                message.enableOriText = reader.bool();
                                break;
                            }
                        case 22: {
                                message.enableNonstream = reader.bool();
                                break;
                            }
                        case 31: {
                                message.showUtterances = reader.bool();
                                break;
                            }
                        case 32: {
                                message.showWords = reader.bool();
                                break;
                            }
                        case 33: {
                                message.showDuration = reader.bool();
                                break;
                            }
                        case 34: {
                                message.showLanguage = reader.bool();
                                break;
                            }
                        case 35: {
                                message.showVolume = reader.bool();
                                break;
                            }
                        case 362: {
                                message.showVolumeV = reader.bool();
                                break;
                            }
                        case 37: {
                                message.showSpeechRate = reader.bool();
                                break;
                            }
                        case 38: {
                                message.showPrefetch = reader.bool();
                                break;
                            }
                        case 39: {
                                message.resultType = reader.string();
                                break;
                            }
                        case 61: {
                                message.startSilenceTime = reader.int32();
                                break;
                            }
                        case 62: {
                                message.endSilenceTime = reader.int32();
                                break;
                            }
                        case 63: {
                                message.vadSilenceTime = reader.int32();
                                break;
                            }
                        case 64: {
                                message.minSilenceTime = reader.int32();
                                break;
                            }
                        case 65: {
                                message.vadMode = reader.string();
                                break;
                            }
                        case 66: {
                                message.vadSegmentDuration = reader.int32();
                                break;
                            }
                        case 67: {
                                message.endWindowSize = reader.int32();
                                break;
                            }
                        case 68: {
                                message.forceToSpeechTime = reader.int32();
                                break;
                            }
                        case 100: {
                                message.corpus = $root.data.speech.understanding.Corpus.decode(reader, reader.uint32());
                                break;
                            }
                        case 101: {
                                message.notification = $root.data.speech.understanding.AsrNotification.decode(reader, reader.uint32());
                                break;
                            }
                        case 102: {
                                message.sensitiveWordsFilter = reader.string();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for ReqParams
                 * @function getTypeUrl
                 * @memberof data.speech.understanding.ReqParams
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                ReqParams.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.understanding.ReqParams";
                };

                return ReqParams;
            })();

            understanding.Corpus = (function() {

                /**
                 * Properties of a Corpus.
                 * @memberof data.speech.understanding
                 * @interface ICorpus
                 * @property {string|null} [context] Corpus context
                 * @property {string|null} [boostingTableId] Corpus boostingTableId
                 * @property {string|null} [boostingTableName] Corpus boostingTableName
                 * @property {string|null} [boostingId] Corpus boostingId
                 * @property {string|null} [nnlmId] Corpus nnlmId
                 * @property {string|null} [correctTableId] Corpus correctTableId
                 * @property {string|null} [correctTableName] Corpus correctTableName
                 * @property {string|null} [puncHotWords] Corpus puncHotWords
                 * @property {Array.<string>|null} [hotWordsList] Corpus hotWordsList
                 * @property {Object.<string,string>|null} [glossaryList] Corpus glossaryList
                 * @property {string|null} [correctWords] Corpus correctWords
                 * @property {string|null} [regexCorrectTableId] Corpus regexCorrectTableId
                 * @property {string|null} [regexCorrectTableName] Corpus regexCorrectTableName
                 * @property {string|null} [glossaryTableId] Corpus glossaryTableId
                 * @property {string|null} [glossaryTableName] Corpus glossaryTableName
                 * @property {boolean|null} [showMatchHotWords] Corpus showMatchHotWords
                 * @property {boolean|null} [showAllMatchHotWords] Corpus showAllMatchHotWords
                 * @property {boolean|null} [showEffectiveHotWords] Corpus showEffectiveHotWords
                 */

                /**
                 * Constructs a new Corpus.
                 * @memberof data.speech.understanding
                 * @classdesc Represents a Corpus.
                 * @implements ICorpus
                 * @constructor
                 * @param {data.speech.understanding.ICorpus=} [properties] Properties to set
                 */
                function Corpus(properties) {
                    this.hotWordsList = [];
                    this.glossaryList = {};
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * Corpus context.
                 * @member {string} context
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.context = "";

                /**
                 * Corpus boostingTableId.
                 * @member {string} boostingTableId
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.boostingTableId = "";

                /**
                 * Corpus boostingTableName.
                 * @member {string} boostingTableName
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.boostingTableName = "";

                /**
                 * Corpus boostingId.
                 * @member {string} boostingId
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.boostingId = "";

                /**
                 * Corpus nnlmId.
                 * @member {string} nnlmId
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.nnlmId = "";

                /**
                 * Corpus correctTableId.
                 * @member {string} correctTableId
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.correctTableId = "";

                /**
                 * Corpus correctTableName.
                 * @member {string} correctTableName
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.correctTableName = "";

                /**
                 * Corpus puncHotWords.
                 * @member {string} puncHotWords
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.puncHotWords = "";

                /**
                 * Corpus hotWordsList.
                 * @member {Array.<string>} hotWordsList
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.hotWordsList = $util.emptyArray;

                /**
                 * Corpus glossaryList.
                 * @member {Object.<string,string>} glossaryList
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.glossaryList = $util.emptyObject;

                /**
                 * Corpus correctWords.
                 * @member {string} correctWords
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.correctWords = "";

                /**
                 * Corpus regexCorrectTableId.
                 * @member {string} regexCorrectTableId
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.regexCorrectTableId = "";

                /**
                 * Corpus regexCorrectTableName.
                 * @member {string} regexCorrectTableName
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.regexCorrectTableName = "";

                /**
                 * Corpus glossaryTableId.
                 * @member {string} glossaryTableId
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.glossaryTableId = "";

                /**
                 * Corpus glossaryTableName.
                 * @member {string} glossaryTableName
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.glossaryTableName = "";

                /**
                 * Corpus showMatchHotWords.
                 * @member {boolean|null|undefined} showMatchHotWords
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.showMatchHotWords = null;

                /**
                 * Corpus showAllMatchHotWords.
                 * @member {boolean|null|undefined} showAllMatchHotWords
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.showAllMatchHotWords = null;

                /**
                 * Corpus showEffectiveHotWords.
                 * @member {boolean|null|undefined} showEffectiveHotWords
                 * @memberof data.speech.understanding.Corpus
                 * @instance
                 */
                Corpus.prototype.showEffectiveHotWords = null;

                // OneOf field names bound to virtual getters and setters
                let $oneOfFields;

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(Corpus.prototype, "_showMatchHotWords", {
                    get: $util.oneOfGetter($oneOfFields = ["showMatchHotWords"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(Corpus.prototype, "_showAllMatchHotWords", {
                    get: $util.oneOfGetter($oneOfFields = ["showAllMatchHotWords"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                Object.defineProperty(Corpus.prototype, "_showEffectiveHotWords", {
                    get: $util.oneOfGetter($oneOfFields = ["showEffectiveHotWords"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                /**
                 * Encodes the specified Corpus message. Does not implicitly {@link data.speech.understanding.Corpus.verify|verify} messages.
                 * @function encode
                 * @memberof data.speech.understanding.Corpus
                 * @static
                 * @param {data.speech.understanding.ICorpus} message Corpus message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                Corpus.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.context != null && Object.hasOwnProperty.call(message, "context"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.context);
                    if (message.boostingTableId != null && Object.hasOwnProperty.call(message, "boostingTableId"))
                        writer.uint32(/* id 2, wireType 2 =*/18).string(message.boostingTableId);
                    if (message.boostingTableName != null && Object.hasOwnProperty.call(message, "boostingTableName"))
                        writer.uint32(/* id 3, wireType 2 =*/26).string(message.boostingTableName);
                    if (message.boostingId != null && Object.hasOwnProperty.call(message, "boostingId"))
                        writer.uint32(/* id 4, wireType 2 =*/34).string(message.boostingId);
                    if (message.nnlmId != null && Object.hasOwnProperty.call(message, "nnlmId"))
                        writer.uint32(/* id 5, wireType 2 =*/42).string(message.nnlmId);
                    if (message.correctTableId != null && Object.hasOwnProperty.call(message, "correctTableId"))
                        writer.uint32(/* id 6, wireType 2 =*/50).string(message.correctTableId);
                    if (message.correctTableName != null && Object.hasOwnProperty.call(message, "correctTableName"))
                        writer.uint32(/* id 7, wireType 2 =*/58).string(message.correctTableName);
                    if (message.puncHotWords != null && Object.hasOwnProperty.call(message, "puncHotWords"))
                        writer.uint32(/* id 8, wireType 2 =*/66).string(message.puncHotWords);
                    if (message.hotWordsList != null && message.hotWordsList.length)
                        for (let i = 0; i < message.hotWordsList.length; ++i)
                            writer.uint32(/* id 9, wireType 2 =*/74).string(message.hotWordsList[i]);
                    if (message.glossaryList != null && Object.hasOwnProperty.call(message, "glossaryList"))
                        for (let keys = Object.keys(message.glossaryList), i = 0; i < keys.length; ++i)
                            writer.uint32(/* id 10, wireType 2 =*/82).fork().uint32(/* id 1, wireType 2 =*/10).string(keys[i]).uint32(/* id 2, wireType 2 =*/18).string(message.glossaryList[keys[i]]).ldelim();
                    if (message.correctWords != null && Object.hasOwnProperty.call(message, "correctWords"))
                        writer.uint32(/* id 11, wireType 2 =*/90).string(message.correctWords);
                    if (message.regexCorrectTableId != null && Object.hasOwnProperty.call(message, "regexCorrectTableId"))
                        writer.uint32(/* id 12, wireType 2 =*/98).string(message.regexCorrectTableId);
                    if (message.regexCorrectTableName != null && Object.hasOwnProperty.call(message, "regexCorrectTableName"))
                        writer.uint32(/* id 13, wireType 2 =*/106).string(message.regexCorrectTableName);
                    if (message.glossaryTableId != null && Object.hasOwnProperty.call(message, "glossaryTableId"))
                        writer.uint32(/* id 14, wireType 2 =*/114).string(message.glossaryTableId);
                    if (message.glossaryTableName != null && Object.hasOwnProperty.call(message, "glossaryTableName"))
                        writer.uint32(/* id 15, wireType 2 =*/122).string(message.glossaryTableName);
                    if (message.showMatchHotWords != null && Object.hasOwnProperty.call(message, "showMatchHotWords"))
                        writer.uint32(/* id 61, wireType 0 =*/488).bool(message.showMatchHotWords);
                    if (message.showAllMatchHotWords != null && Object.hasOwnProperty.call(message, "showAllMatchHotWords"))
                        writer.uint32(/* id 62, wireType 0 =*/496).bool(message.showAllMatchHotWords);
                    if (message.showEffectiveHotWords != null && Object.hasOwnProperty.call(message, "showEffectiveHotWords"))
                        writer.uint32(/* id 63, wireType 0 =*/504).bool(message.showEffectiveHotWords);
                    return writer;
                };

                /**
                 * Decodes a Corpus message from the specified reader or buffer.
                 * @function decode
                 * @memberof data.speech.understanding.Corpus
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {data.speech.understanding.Corpus} Corpus
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                Corpus.decode = function decode(reader, length, error) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.data.speech.understanding.Corpus(), key, value;
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.context = reader.string();
                                break;
                            }
                        case 2: {
                                message.boostingTableId = reader.string();
                                break;
                            }
                        case 3: {
                                message.boostingTableName = reader.string();
                                break;
                            }
                        case 4: {
                                message.boostingId = reader.string();
                                break;
                            }
                        case 5: {
                                message.nnlmId = reader.string();
                                break;
                            }
                        case 6: {
                                message.correctTableId = reader.string();
                                break;
                            }
                        case 7: {
                                message.correctTableName = reader.string();
                                break;
                            }
                        case 8: {
                                message.puncHotWords = reader.string();
                                break;
                            }
                        case 9: {
                                if (!(message.hotWordsList && message.hotWordsList.length))
                                    message.hotWordsList = [];
                                message.hotWordsList.push(reader.string());
                                break;
                            }
                        case 10: {
                                if (message.glossaryList === $util.emptyObject)
                                    message.glossaryList = {};
                                let end2 = reader.uint32() + reader.pos;
                                key = "";
                                value = "";
                                while (reader.pos < end2) {
                                    let tag2 = reader.uint32();
                                    switch (tag2 >>> 3) {
                                    case 1:
                                        key = reader.string();
                                        break;
                                    case 2:
                                        value = reader.string();
                                        break;
                                    default:
                                        reader.skipType(tag2 & 7);
                                        break;
                                    }
                                }
                                message.glossaryList[key] = value;
                                break;
                            }
                        case 11: {
                                message.correctWords = reader.string();
                                break;
                            }
                        case 12: {
                                message.regexCorrectTableId = reader.string();
                                break;
                            }
                        case 13: {
                                message.regexCorrectTableName = reader.string();
                                break;
                            }
                        case 14: {
                                message.glossaryTableId = reader.string();
                                break;
                            }
                        case 15: {
                                message.glossaryTableName = reader.string();
                                break;
                            }
                        case 61: {
                                message.showMatchHotWords = reader.bool();
                                break;
                            }
                        case 62: {
                                message.showAllMatchHotWords = reader.bool();
                                break;
                            }
                        case 63: {
                                message.showEffectiveHotWords = reader.bool();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Gets the default type url for Corpus
                 * @function getTypeUrl
                 * @memberof data.speech.understanding.Corpus
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                Corpus.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/data.speech.understanding.Corpus";
                };

                return Corpus;
            })();

            return understanding;
        })();

        return speech;
    })();

    return data;
})();

export { $root as default };
