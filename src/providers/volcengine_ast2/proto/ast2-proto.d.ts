import * as $protobuf from "protobufjs";
import Long = require("long");
/** Namespace data. */
export namespace data {

    /** Namespace speech. */
    namespace speech {

        /** Namespace ast. */
        namespace ast {

            /** Properties of a ReqParams. */
            interface IReqParams {

                /** ReqParams mode */
                mode?: (string|null);

                /** ReqParams sourceLanguage */
                sourceLanguage?: (string|null);

                /** ReqParams targetLanguage */
                targetLanguage?: (string|null);

                /** ReqParams speakerId */
                speakerId?: (string|null);

                /** ReqParams corpus */
                corpus?: (data.speech.understanding.ICorpus|null);
            }

            /** Represents a ReqParams. */
            class ReqParams implements IReqParams {

                /**
                 * Constructs a new ReqParams.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.ast.IReqParams);

                /** ReqParams mode. */
                public mode: string;

                /** ReqParams sourceLanguage. */
                public sourceLanguage: string;

                /** ReqParams targetLanguage. */
                public targetLanguage: string;

                /** ReqParams speakerId. */
                public speakerId: string;

                /** ReqParams corpus. */
                public corpus?: (data.speech.understanding.ICorpus|null);

                /**
                 * Encodes the specified ReqParams message. Does not implicitly {@link data.speech.ast.ReqParams.verify|verify} messages.
                 * @param message ReqParams message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.ast.IReqParams, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a ReqParams message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns ReqParams
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.ast.ReqParams;

                /**
                 * Gets the default type url for ReqParams
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of a TranslateRequest. */
            interface ITranslateRequest {

                /** TranslateRequest requestMeta */
                requestMeta?: (data.speech.common.IRequestMeta|null);

                /** TranslateRequest event */
                event?: (data.speech.event.Type|null);

                /** TranslateRequest user */
                user?: (data.speech.understanding.IUser|null);

                /** TranslateRequest sourceAudio */
                sourceAudio?: (data.speech.understanding.IAudio|null);

                /** TranslateRequest targetAudio */
                targetAudio?: (data.speech.understanding.IAudio|null);

                /** TranslateRequest request */
                request?: (data.speech.ast.IReqParams|null);

                /** TranslateRequest denoise */
                denoise?: (boolean|null);
            }

            /** Represents a TranslateRequest. */
            class TranslateRequest implements ITranslateRequest {

                /**
                 * Constructs a new TranslateRequest.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.ast.ITranslateRequest);

                /** TranslateRequest requestMeta. */
                public requestMeta?: (data.speech.common.IRequestMeta|null);

                /** TranslateRequest event. */
                public event: data.speech.event.Type;

                /** TranslateRequest user. */
                public user?: (data.speech.understanding.IUser|null);

                /** TranslateRequest sourceAudio. */
                public sourceAudio?: (data.speech.understanding.IAudio|null);

                /** TranslateRequest targetAudio. */
                public targetAudio?: (data.speech.understanding.IAudio|null);

                /** TranslateRequest request. */
                public request?: (data.speech.ast.IReqParams|null);

                /** TranslateRequest denoise. */
                public denoise?: (boolean|null);

                /**
                 * Encodes the specified TranslateRequest message. Does not implicitly {@link data.speech.ast.TranslateRequest.verify|verify} messages.
                 * @param message TranslateRequest message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.ast.ITranslateRequest, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a TranslateRequest message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns TranslateRequest
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.ast.TranslateRequest;

                /**
                 * Gets the default type url for TranslateRequest
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of a TranslateResponse. */
            interface ITranslateResponse {

                /** TranslateResponse responseMeta */
                responseMeta?: (data.speech.common.IResponseMeta|null);

                /** TranslateResponse event */
                event?: (data.speech.event.Type|null);

                /** TranslateResponse data */
                data?: (Uint8Array|null);

                /** TranslateResponse text */
                text?: (string|null);

                /** TranslateResponse startTime */
                startTime?: (number|null);

                /** TranslateResponse endTime */
                endTime?: (number|null);

                /** TranslateResponse spkChg */
                spkChg?: (boolean|null);

                /** TranslateResponse mutedDurationMs */
                mutedDurationMs?: (number|null);
            }

            /** Represents a TranslateResponse. */
            class TranslateResponse implements ITranslateResponse {

                /**
                 * Constructs a new TranslateResponse.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.ast.ITranslateResponse);

                /** TranslateResponse responseMeta. */
                public responseMeta?: (data.speech.common.IResponseMeta|null);

                /** TranslateResponse event. */
                public event: data.speech.event.Type;

                /** TranslateResponse data. */
                public data: Uint8Array;

                /** TranslateResponse text. */
                public text: string;

                /** TranslateResponse startTime. */
                public startTime: number;

                /** TranslateResponse endTime. */
                public endTime: number;

                /** TranslateResponse spkChg. */
                public spkChg: boolean;

                /** TranslateResponse mutedDurationMs. */
                public mutedDurationMs: number;

                /**
                 * Encodes the specified TranslateResponse message. Does not implicitly {@link data.speech.ast.TranslateResponse.verify|verify} messages.
                 * @param message TranslateResponse message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.ast.ITranslateResponse, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a TranslateResponse message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns TranslateResponse
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.ast.TranslateResponse;

                /**
                 * Gets the default type url for TranslateResponse
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Represents a ASTService */
            class ASTService extends $protobuf.rpc.Service {

                /**
                 * Constructs a new ASTService service.
                 * @param rpcImpl RPC implementation
                 * @param [requestDelimited=false] Whether requests are length-delimited
                 * @param [responseDelimited=false] Whether responses are length-delimited
                 */
                constructor(rpcImpl: $protobuf.RPCImpl, requestDelimited?: boolean, responseDelimited?: boolean);

                /**
                 * Calls Translate.
                 * @param request TranslateRequest message or plain object
                 * @param callback Node-style callback called with the error, if any, and TranslateResponse
                 */
                public translate(request: data.speech.ast.ITranslateRequest, callback: data.speech.ast.ASTService.TranslateCallback): void;

                /**
                 * Calls Translate.
                 * @param request TranslateRequest message or plain object
                 * @returns Promise
                 */
                public translate(request: data.speech.ast.ITranslateRequest): Promise<data.speech.ast.TranslateResponse>;
            }

            namespace ASTService {

                /**
                 * Callback as used by {@link data.speech.ast.ASTService#translate}.
                 * @param error Error, if any
                 * @param [response] TranslateResponse
                 */
                type TranslateCallback = (error: (Error|null), response?: data.speech.ast.TranslateResponse) => void;
            }
        }

        /** Namespace event. */
        namespace event {

            /** Type enum. */
            enum Type {
                None = 0,
                StartConnection = 1,
                StartTask = 1,
                FinishConnection = 2,
                FinishTask = 2,
                ConnectionStarted = 50,
                TaskStarted = 50,
                ConnectionFailed = 51,
                TaskFailed = 51,
                ConnectionFinished = 52,
                TaskFinished = 52,
                StartSession = 100,
                CancelSession = 101,
                FinishSession = 102,
                SessionStarted = 150,
                SessionCanceled = 151,
                SessionFinished = 152,
                SessionFailed = 153,
                UsageResponse = 154,
                ChargeData = 154,
                TaskRequest = 200,
                UpdateConfig = 201,
                ImageRequest = 202,
                AudioMuted = 250,
                SayHello = 300,
                TTSSentenceStart = 350,
                TTSSentenceEnd = 351,
                TTSResponse = 352,
                TTSEnded = 359,
                PodcastRoundStart = 360,
                PodcastRoundResponse = 361,
                PodcastRoundEnd = 362,
                ASRInfo = 450,
                ASRResponse = 451,
                ASREnded = 459,
                ChatTTSText = 500,
                ChatTextQuery = 501,
                ChatResponse = 550,
                ChimeInStart = 551,
                ChimeInEnd = 552,
                ChatEnded = 559,
                ThinkStart = 560,
                ThinkResponse = 561,
                ThinkEnd = 562,
                ToolOutput = 563,
                FCResponseStart = 564,
                FCResponse = 565,
                FCResponseEnd = 566,
                SourceSubtitleStart = 650,
                SourceSubtitleResponse = 651,
                SourceSubtitleEnd = 652,
                TranslationSubtitleStart = 653,
                TranslationSubtitleResponse = 654,
                TranslationSubtitleEnd = 655
            }
        }

        /** Namespace common. */
        namespace common {

            /** Properties of a RequestMeta. */
            interface IRequestMeta {

                /** RequestMeta Endpoint */
                Endpoint?: (string|null);

                /** RequestMeta AppKey */
                AppKey?: (string|null);

                /** RequestMeta AppID */
                AppID?: (string|null);

                /** RequestMeta ResourceID */
                ResourceID?: (string|null);

                /** RequestMeta ConnectionID */
                ConnectionID?: (string|null);

                /** RequestMeta SessionID */
                SessionID?: (string|null);

                /** RequestMeta Sequence */
                Sequence?: (number|null);
            }

            /** Represents a RequestMeta. */
            class RequestMeta implements IRequestMeta {

                /**
                 * Constructs a new RequestMeta.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.common.IRequestMeta);

                /** RequestMeta Endpoint. */
                public Endpoint: string;

                /** RequestMeta AppKey. */
                public AppKey: string;

                /** RequestMeta AppID. */
                public AppID: string;

                /** RequestMeta ResourceID. */
                public ResourceID: string;

                /** RequestMeta ConnectionID. */
                public ConnectionID: string;

                /** RequestMeta SessionID. */
                public SessionID: string;

                /** RequestMeta Sequence. */
                public Sequence: number;

                /**
                 * Encodes the specified RequestMeta message. Does not implicitly {@link data.speech.common.RequestMeta.verify|verify} messages.
                 * @param message RequestMeta message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.common.IRequestMeta, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a RequestMeta message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns RequestMeta
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.common.RequestMeta;

                /**
                 * Gets the default type url for RequestMeta
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of a BillingItem. */
            interface IBillingItem {

                /** BillingItem Unit */
                Unit?: (string|null);

                /** BillingItem Quantity */
                Quantity?: (number|null);
            }

            /** Represents a BillingItem. */
            class BillingItem implements IBillingItem {

                /**
                 * Constructs a new BillingItem.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.common.IBillingItem);

                /** BillingItem Unit. */
                public Unit: string;

                /** BillingItem Quantity. */
                public Quantity: number;

                /**
                 * Encodes the specified BillingItem message. Does not implicitly {@link data.speech.common.BillingItem.verify|verify} messages.
                 * @param message BillingItem message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.common.IBillingItem, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a BillingItem message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns BillingItem
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.common.BillingItem;

                /**
                 * Gets the default type url for BillingItem
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of a Billing. */
            interface IBilling {

                /** Billing Items */
                Items?: (data.speech.common.IBillingItem[]|null);

                /** Billing DurationMsec */
                DurationMsec?: (number|Long|null);

                /** Billing WordCount */
                WordCount?: (number|Long|null);
            }

            /** Represents a Billing. */
            class Billing implements IBilling {

                /**
                 * Constructs a new Billing.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.common.IBilling);

                /** Billing Items. */
                public Items: data.speech.common.IBillingItem[];

                /** Billing DurationMsec. */
                public DurationMsec: (number|Long);

                /** Billing WordCount. */
                public WordCount: (number|Long);

                /**
                 * Encodes the specified Billing message. Does not implicitly {@link data.speech.common.Billing.verify|verify} messages.
                 * @param message Billing message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.common.IBilling, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a Billing message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns Billing
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.common.Billing;

                /**
                 * Gets the default type url for Billing
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of a ResponseMeta. */
            interface IResponseMeta {

                /** ResponseMeta SessionID */
                SessionID?: (string|null);

                /** ResponseMeta Sequence */
                Sequence?: (number|null);

                /** ResponseMeta StatusCode */
                StatusCode?: (number|null);

                /** ResponseMeta Message */
                Message?: (string|null);

                /** ResponseMeta Billing */
                Billing?: (data.speech.common.IBilling|null);
            }

            /** Represents a ResponseMeta. */
            class ResponseMeta implements IResponseMeta {

                /**
                 * Constructs a new ResponseMeta.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.common.IResponseMeta);

                /** ResponseMeta SessionID. */
                public SessionID: string;

                /** ResponseMeta Sequence. */
                public Sequence: number;

                /** ResponseMeta StatusCode. */
                public StatusCode: number;

                /** ResponseMeta Message. */
                public Message: string;

                /** ResponseMeta Billing. */
                public Billing?: (data.speech.common.IBilling|null);

                /**
                 * Encodes the specified ResponseMeta message. Does not implicitly {@link data.speech.common.ResponseMeta.verify|verify} messages.
                 * @param message ResponseMeta message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.common.IResponseMeta, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a ResponseMeta message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns ResponseMeta
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.common.ResponseMeta;

                /**
                 * Gets the default type url for ResponseMeta
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }
        }

        /** Namespace understanding. */
        namespace understanding {

            /** Code enum. */
            enum Code {
                ERROR_UNSPECIFIED = 0,
                SUCCESS = 21000,
                INVALID_REQUEST = 11100,
                PERMISSION_DENIED = 11200,
                LIMIT_QPS = 11301,
                LIMIT_COUNT = 11302,
                SERVER_BUSY = 11303,
                INTERRUPTED = 21300,
                ERROR_PARAMS = 11500,
                LONG_AUDIO = 11101,
                LARGE_PACKET = 11102,
                INVALID_FORMAT = 11103,
                SILENT_AUDIO = 11104,
                EMPTY_AUDIO = 11105,
                AUDIO_DOWNLOAD_FAIL = 21701,
                TIMEOUT_WAITING = 21200,
                TIMEOUT_PROCESSING = 21201,
                ERROR_PROCESSING = 21100,
                ERROR_UNKNOWN = 29900
            }

            /** Properties of a Word. */
            interface IWord {

                /** Word text */
                text?: (string|null);

                /** Word startTime */
                startTime?: (number|null);

                /** Word endTime */
                endTime?: (number|null);

                /** Word blankDuration */
                blankDuration?: (number|null);

                /** Word pronounce */
                pronounce?: (string|null);

                /** Word confidence */
                confidence?: (number|null);
            }

            /** Represents a Word. */
            class Word implements IWord {

                /**
                 * Constructs a new Word.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.understanding.IWord);

                /** Word text. */
                public text: string;

                /** Word startTime. */
                public startTime: number;

                /** Word endTime. */
                public endTime: number;

                /** Word blankDuration. */
                public blankDuration: number;

                /** Word pronounce. */
                public pronounce: string;

                /** Word confidence. */
                public confidence: number;

                /**
                 * Encodes the specified Word message. Does not implicitly {@link data.speech.understanding.Word.verify|verify} messages.
                 * @param message Word message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.understanding.IWord, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a Word message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns Word
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.understanding.Word;

                /**
                 * Gets the default type url for Word
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of an UtteranceAddition. */
            interface IUtteranceAddition {
            }

            /** Represents an UtteranceAddition. */
            class UtteranceAddition implements IUtteranceAddition {

                /**
                 * Constructs a new UtteranceAddition.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.understanding.IUtteranceAddition);

                /**
                 * Encodes the specified UtteranceAddition message. Does not implicitly {@link data.speech.understanding.UtteranceAddition.verify|verify} messages.
                 * @param message UtteranceAddition message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.understanding.IUtteranceAddition, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes an UtteranceAddition message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns UtteranceAddition
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.understanding.UtteranceAddition;

                /**
                 * Gets the default type url for UtteranceAddition
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of a ResultAddition. */
            interface IResultAddition {
            }

            /** Represents a ResultAddition. */
            class ResultAddition implements IResultAddition {

                /**
                 * Constructs a new ResultAddition.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.understanding.IResultAddition);

                /**
                 * Encodes the specified ResultAddition message. Does not implicitly {@link data.speech.understanding.ResultAddition.verify|verify} messages.
                 * @param message ResultAddition message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.understanding.IResultAddition, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a ResultAddition message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns ResultAddition
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.understanding.ResultAddition;

                /**
                 * Gets the default type url for ResultAddition
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of an Utterance. */
            interface IUtterance {

                /** Utterance text */
                text?: (string|null);

                /** Utterance startTime */
                startTime?: (number|null);

                /** Utterance endTime */
                endTime?: (number|null);

                /** Utterance definite */
                definite?: (boolean|null);

                /** Utterance words */
                words?: (data.speech.understanding.IWord[]|null);

                /** Utterance language */
                language?: (string|null);

                /** Utterance confidence */
                confidence?: (number|null);

                /** Utterance speaker */
                speaker?: (number|null);

                /** Utterance channelId */
                channelId?: (number|null);

                /** Utterance additions */
                additions?: ({ [k: string]: string }|null);
            }

            /** Represents an Utterance. */
            class Utterance implements IUtterance {

                /**
                 * Constructs a new Utterance.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.understanding.IUtterance);

                /** Utterance text. */
                public text: string;

                /** Utterance startTime. */
                public startTime: number;

                /** Utterance endTime. */
                public endTime: number;

                /** Utterance definite. */
                public definite?: (boolean|null);

                /** Utterance words. */
                public words: data.speech.understanding.IWord[];

                /** Utterance language. */
                public language: string;

                /** Utterance confidence. */
                public confidence: number;

                /** Utterance speaker. */
                public speaker: number;

                /** Utterance channelId. */
                public channelId: number;

                /** Utterance additions. */
                public additions: { [k: string]: string };

                /**
                 * Encodes the specified Utterance message. Does not implicitly {@link data.speech.understanding.Utterance.verify|verify} messages.
                 * @param message Utterance message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.understanding.IUtterance, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes an Utterance message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns Utterance
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.understanding.Utterance;

                /**
                 * Gets the default type url for Utterance
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of a LanguageDetail. */
            interface ILanguageDetail {

                /** LanguageDetail prob */
                prob?: (number|null);
            }

            /** Represents a LanguageDetail. */
            class LanguageDetail implements ILanguageDetail {

                /**
                 * Constructs a new LanguageDetail.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.understanding.ILanguageDetail);

                /** LanguageDetail prob. */
                public prob: number;

                /**
                 * Encodes the specified LanguageDetail message. Does not implicitly {@link data.speech.understanding.LanguageDetail.verify|verify} messages.
                 * @param message LanguageDetail message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.understanding.ILanguageDetail, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a LanguageDetail message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns LanguageDetail
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.understanding.LanguageDetail;

                /**
                 * Gets the default type url for LanguageDetail
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of a Result. */
            interface IResult {

                /** Result text */
                text?: (string|null);

                /** Result utterances */
                utterances?: (data.speech.understanding.IUtterance[]|null);

                /** Result confidence */
                confidence?: (number|null);

                /** Result globalConfidence */
                globalConfidence?: (number|null);

                /** Result language */
                language?: (string|null);

                /** Result languageDetails */
                languageDetails?: ({ [k: string]: data.speech.understanding.ILanguageDetail }|null);

                /** Result termination */
                termination?: (boolean|null);

                /** Result volume */
                volume?: (number|null);

                /** Result speechRate */
                speechRate?: (number|null);

                /** Result resultType */
                resultType?: (string|null);

                /** Result oriText */
                oriText?: (string|null);

                /** Result prefetch */
                prefetch?: (boolean|null);

                /** Result additions */
                additions?: ({ [k: string]: string }|null);
            }

            /** Represents a Result. */
            class Result implements IResult {

                /**
                 * Constructs a new Result.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.understanding.IResult);

                /** Result text. */
                public text: string;

                /** Result utterances. */
                public utterances: data.speech.understanding.IUtterance[];

                /** Result confidence. */
                public confidence: number;

                /** Result globalConfidence. */
                public globalConfidence: number;

                /** Result language. */
                public language: string;

                /** Result languageDetails. */
                public languageDetails: { [k: string]: data.speech.understanding.ILanguageDetail };

                /** Result termination. */
                public termination?: (boolean|null);

                /** Result volume. */
                public volume: number;

                /** Result speechRate. */
                public speechRate: number;

                /** Result resultType. */
                public resultType: string;

                /** Result oriText. */
                public oriText: string;

                /** Result prefetch. */
                public prefetch?: (boolean|null);

                /** Result additions. */
                public additions: { [k: string]: string };

                /**
                 * Encodes the specified Result message. Does not implicitly {@link data.speech.understanding.Result.verify|verify} messages.
                 * @param message Result message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.understanding.IResult, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a Result message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns Result
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.understanding.Result;

                /**
                 * Gets the default type url for Result
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of an AudioInfo. */
            interface IAudioInfo {

                /** AudioInfo duration */
                duration?: (number|Long|null);

                /** AudioInfo speechRate */
                speechRate?: (number|null);
            }

            /** Represents an AudioInfo. */
            class AudioInfo implements IAudioInfo {

                /**
                 * Constructs a new AudioInfo.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.understanding.IAudioInfo);

                /** AudioInfo duration. */
                public duration: (number|Long);

                /** AudioInfo speechRate. */
                public speechRate: number;

                /**
                 * Encodes the specified AudioInfo message. Does not implicitly {@link data.speech.understanding.AudioInfo.verify|verify} messages.
                 * @param message AudioInfo message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.understanding.IAudioInfo, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes an AudioInfo message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns AudioInfo
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.understanding.AudioInfo;

                /**
                 * Gets the default type url for AudioInfo
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of an App. */
            interface IApp {

                /** App workFlowName */
                workFlowName?: (string|null);
            }

            /** Represents an App. */
            class App implements IApp {

                /**
                 * Constructs a new App.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.understanding.IApp);

                /** App workFlowName. */
                public workFlowName: string;

                /**
                 * Encodes the specified App message. Does not implicitly {@link data.speech.understanding.App.verify|verify} messages.
                 * @param message App message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.understanding.IApp, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes an App message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns App
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.understanding.App;

                /**
                 * Gets the default type url for App
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of a User. */
            interface IUser {

                /** User uid */
                uid?: (string|null);

                /** User did */
                did?: (string|null);

                /** User platform */
                platform?: (string|null);

                /** User sdkVersion */
                sdkVersion?: (string|null);

                /** User appVersion */
                appVersion?: (string|null);
            }

            /** Represents a User. */
            class User implements IUser {

                /**
                 * Constructs a new User.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.understanding.IUser);

                /** User uid. */
                public uid: string;

                /** User did. */
                public did: string;

                /** User platform. */
                public platform: string;

                /** User sdkVersion. */
                public sdkVersion: string;

                /** User appVersion. */
                public appVersion: string;

                /**
                 * Encodes the specified User message. Does not implicitly {@link data.speech.understanding.User.verify|verify} messages.
                 * @param message User message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.understanding.IUser, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a User message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns User
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.understanding.User;

                /**
                 * Gets the default type url for User
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of an Audio. */
            interface IAudio {

                /** Audio data */
                data?: (string|null);

                /** Audio url */
                url?: (string|null);

                /** Audio urlType */
                urlType?: (string|null);

                /** Audio format */
                format?: (string|null);

                /** Audio codec */
                codec?: (string|null);

                /** Audio language */
                language?: (string|null);

                /** Audio rate */
                rate?: (number|null);

                /** Audio bits */
                bits?: (number|null);

                /** Audio channel */
                channel?: (number|null);

                /** Audio tosBucket */
                tosBucket?: (string|null);

                /** Audio tosAccessKey */
                tosAccessKey?: (string|null);

                /** Audio audioTosObject */
                audioTosObject?: (string|null);

                /** Audio roleTrn */
                roleTrn?: (string|null);

                /** Audio binaryData */
                binaryData?: (Uint8Array|null);
            }

            /** Represents an Audio. */
            class Audio implements IAudio {

                /**
                 * Constructs a new Audio.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.understanding.IAudio);

                /** Audio data. */
                public data: string;

                /** Audio url. */
                public url: string;

                /** Audio urlType. */
                public urlType: string;

                /** Audio format. */
                public format: string;

                /** Audio codec. */
                public codec: string;

                /** Audio language. */
                public language: string;

                /** Audio rate. */
                public rate: number;

                /** Audio bits. */
                public bits: number;

                /** Audio channel. */
                public channel: number;

                /** Audio tosBucket. */
                public tosBucket: string;

                /** Audio tosAccessKey. */
                public tosAccessKey: string;

                /** Audio audioTosObject. */
                public audioTosObject: string;

                /** Audio roleTrn. */
                public roleTrn: string;

                /** Audio binaryData. */
                public binaryData: Uint8Array;

                /**
                 * Encodes the specified Audio message. Does not implicitly {@link data.speech.understanding.Audio.verify|verify} messages.
                 * @param message Audio message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.understanding.IAudio, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes an Audio message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns Audio
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.understanding.Audio;

                /**
                 * Gets the default type url for Audio
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** AsrNotificationCode enum. */
            enum AsrNotificationCode {
                NOTIFICATION_UNSPECIFIED = 0,
                DISCONNECT = 1000
            }

            /** Properties of an AsrNotification. */
            interface IAsrNotification {

                /** AsrNotification code */
                code?: (data.speech.understanding.AsrNotificationCode|null);

                /** AsrNotification message */
                message?: (string|null);
            }

            /** Represents an AsrNotification. */
            class AsrNotification implements IAsrNotification {

                /**
                 * Constructs a new AsrNotification.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.understanding.IAsrNotification);

                /** AsrNotification code. */
                public code: data.speech.understanding.AsrNotificationCode;

                /** AsrNotification message. */
                public message: string;

                /**
                 * Encodes the specified AsrNotification message. Does not implicitly {@link data.speech.understanding.AsrNotification.verify|verify} messages.
                 * @param message AsrNotification message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.understanding.IAsrNotification, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes an AsrNotification message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns AsrNotification
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.understanding.AsrNotification;

                /**
                 * Gets the default type url for AsrNotification
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of a ReqParams. */
            interface IReqParams {

                /** ReqParams modelName */
                modelName?: (string|null);

                /** ReqParams configName */
                configName?: (string|null);

                /** ReqParams enableVad */
                enableVad?: (boolean|null);

                /** ReqParams enablePunc */
                enablePunc?: (boolean|null);

                /** ReqParams enableItn */
                enableItn?: (boolean|null);

                /** ReqParams enableDdc */
                enableDdc?: (boolean|null);

                /** ReqParams enableResample */
                enableResample?: (boolean|null);

                /** ReqParams vadSignal */
                vadSignal?: (boolean|null);

                /** ReqParams enableTranslate */
                enableTranslate?: (boolean|null);

                /** ReqParams disableEndPunc */
                disableEndPunc?: (boolean|null);

                /** ReqParams enableSpeakerInfo */
                enableSpeakerInfo?: (boolean|null);

                /** ReqParams enableChannelSplit */
                enableChannelSplit?: (boolean|null);

                /** ReqParams appLang */
                appLang?: (string|null);

                /** ReqParams country */
                country?: (string|null);

                /** ReqParams audioType */
                audioType?: (string|null);

                /** ReqParams enableLid */
                enableLid?: (boolean|null);

                /** ReqParams reco2actNumSpk */
                reco2actNumSpk?: (number|null);

                /** ReqParams reco2maxNumSpk */
                reco2maxNumSpk?: (number|null);

                /** ReqParams enableInterrupt */
                enableInterrupt?: (boolean|null);

                /** ReqParams vadSegment */
                vadSegment?: (boolean|null);

                /** ReqParams enableOriText */
                enableOriText?: (boolean|null);

                /** ReqParams enableNonstream */
                enableNonstream?: (boolean|null);

                /** ReqParams showUtterances */
                showUtterances?: (boolean|null);

                /** ReqParams showWords */
                showWords?: (boolean|null);

                /** ReqParams showDuration */
                showDuration?: (boolean|null);

                /** ReqParams showLanguage */
                showLanguage?: (boolean|null);

                /** ReqParams showVolume */
                showVolume?: (boolean|null);

                /** ReqParams showVolumeV */
                showVolumeV?: (boolean|null);

                /** ReqParams showSpeechRate */
                showSpeechRate?: (boolean|null);

                /** ReqParams showPrefetch */
                showPrefetch?: (boolean|null);

                /** ReqParams resultType */
                resultType?: (string|null);

                /** ReqParams startSilenceTime */
                startSilenceTime?: (number|null);

                /** ReqParams endSilenceTime */
                endSilenceTime?: (number|null);

                /** ReqParams vadSilenceTime */
                vadSilenceTime?: (number|null);

                /** ReqParams minSilenceTime */
                minSilenceTime?: (number|null);

                /** ReqParams vadMode */
                vadMode?: (string|null);

                /** ReqParams vadSegmentDuration */
                vadSegmentDuration?: (number|null);

                /** ReqParams endWindowSize */
                endWindowSize?: (number|null);

                /** ReqParams forceToSpeechTime */
                forceToSpeechTime?: (number|null);

                /** ReqParams corpus */
                corpus?: (data.speech.understanding.ICorpus|null);

                /** ReqParams notification */
                notification?: (data.speech.understanding.IAsrNotification|null);

                /** ReqParams sensitiveWordsFilter */
                sensitiveWordsFilter?: (string|null);
            }

            /** Represents a ReqParams. */
            class ReqParams implements IReqParams {

                /**
                 * Constructs a new ReqParams.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.understanding.IReqParams);

                /** ReqParams modelName. */
                public modelName: string;

                /** ReqParams configName. */
                public configName: string;

                /** ReqParams enableVad. */
                public enableVad?: (boolean|null);

                /** ReqParams enablePunc. */
                public enablePunc?: (boolean|null);

                /** ReqParams enableItn. */
                public enableItn?: (boolean|null);

                /** ReqParams enableDdc. */
                public enableDdc?: (boolean|null);

                /** ReqParams enableResample. */
                public enableResample?: (boolean|null);

                /** ReqParams vadSignal. */
                public vadSignal?: (boolean|null);

                /** ReqParams enableTranslate. */
                public enableTranslate?: (boolean|null);

                /** ReqParams disableEndPunc. */
                public disableEndPunc?: (boolean|null);

                /** ReqParams enableSpeakerInfo. */
                public enableSpeakerInfo?: (boolean|null);

                /** ReqParams enableChannelSplit. */
                public enableChannelSplit?: (boolean|null);

                /** ReqParams appLang. */
                public appLang: string;

                /** ReqParams country. */
                public country: string;

                /** ReqParams audioType. */
                public audioType: string;

                /** ReqParams enableLid. */
                public enableLid?: (boolean|null);

                /** ReqParams reco2actNumSpk. */
                public reco2actNumSpk: number;

                /** ReqParams reco2maxNumSpk. */
                public reco2maxNumSpk: number;

                /** ReqParams enableInterrupt. */
                public enableInterrupt?: (boolean|null);

                /** ReqParams vadSegment. */
                public vadSegment?: (boolean|null);

                /** ReqParams enableOriText. */
                public enableOriText?: (boolean|null);

                /** ReqParams enableNonstream. */
                public enableNonstream?: (boolean|null);

                /** ReqParams showUtterances. */
                public showUtterances?: (boolean|null);

                /** ReqParams showWords. */
                public showWords?: (boolean|null);

                /** ReqParams showDuration. */
                public showDuration?: (boolean|null);

                /** ReqParams showLanguage. */
                public showLanguage?: (boolean|null);

                /** ReqParams showVolume. */
                public showVolume?: (boolean|null);

                /** ReqParams showVolumeV. */
                public showVolumeV?: (boolean|null);

                /** ReqParams showSpeechRate. */
                public showSpeechRate?: (boolean|null);

                /** ReqParams showPrefetch. */
                public showPrefetch?: (boolean|null);

                /** ReqParams resultType. */
                public resultType: string;

                /** ReqParams startSilenceTime. */
                public startSilenceTime: number;

                /** ReqParams endSilenceTime. */
                public endSilenceTime: number;

                /** ReqParams vadSilenceTime. */
                public vadSilenceTime: number;

                /** ReqParams minSilenceTime. */
                public minSilenceTime: number;

                /** ReqParams vadMode. */
                public vadMode: string;

                /** ReqParams vadSegmentDuration. */
                public vadSegmentDuration: number;

                /** ReqParams endWindowSize. */
                public endWindowSize: number;

                /** ReqParams forceToSpeechTime. */
                public forceToSpeechTime: number;

                /** ReqParams corpus. */
                public corpus?: (data.speech.understanding.ICorpus|null);

                /** ReqParams notification. */
                public notification?: (data.speech.understanding.IAsrNotification|null);

                /** ReqParams sensitiveWordsFilter. */
                public sensitiveWordsFilter: string;

                /**
                 * Encodes the specified ReqParams message. Does not implicitly {@link data.speech.understanding.ReqParams.verify|verify} messages.
                 * @param message ReqParams message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.understanding.IReqParams, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a ReqParams message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns ReqParams
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.understanding.ReqParams;

                /**
                 * Gets the default type url for ReqParams
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of a Corpus. */
            interface ICorpus {

                /** Corpus context */
                context?: (string|null);

                /** Corpus boostingTableId */
                boostingTableId?: (string|null);

                /** Corpus boostingTableName */
                boostingTableName?: (string|null);

                /** Corpus boostingId */
                boostingId?: (string|null);

                /** Corpus nnlmId */
                nnlmId?: (string|null);

                /** Corpus correctTableId */
                correctTableId?: (string|null);

                /** Corpus correctTableName */
                correctTableName?: (string|null);

                /** Corpus puncHotWords */
                puncHotWords?: (string|null);

                /** Corpus hotWordsList */
                hotWordsList?: (string[]|null);

                /** Corpus glossaryList */
                glossaryList?: ({ [k: string]: string }|null);

                /** Corpus correctWords */
                correctWords?: (string|null);

                /** Corpus regexCorrectTableId */
                regexCorrectTableId?: (string|null);

                /** Corpus regexCorrectTableName */
                regexCorrectTableName?: (string|null);

                /** Corpus glossaryTableId */
                glossaryTableId?: (string|null);

                /** Corpus glossaryTableName */
                glossaryTableName?: (string|null);

                /** Corpus showMatchHotWords */
                showMatchHotWords?: (boolean|null);

                /** Corpus showAllMatchHotWords */
                showAllMatchHotWords?: (boolean|null);

                /** Corpus showEffectiveHotWords */
                showEffectiveHotWords?: (boolean|null);
            }

            /** Represents a Corpus. */
            class Corpus implements ICorpus {

                /**
                 * Constructs a new Corpus.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: data.speech.understanding.ICorpus);

                /** Corpus context. */
                public context: string;

                /** Corpus boostingTableId. */
                public boostingTableId: string;

                /** Corpus boostingTableName. */
                public boostingTableName: string;

                /** Corpus boostingId. */
                public boostingId: string;

                /** Corpus nnlmId. */
                public nnlmId: string;

                /** Corpus correctTableId. */
                public correctTableId: string;

                /** Corpus correctTableName. */
                public correctTableName: string;

                /** Corpus puncHotWords. */
                public puncHotWords: string;

                /** Corpus hotWordsList. */
                public hotWordsList: string[];

                /** Corpus glossaryList. */
                public glossaryList: { [k: string]: string };

                /** Corpus correctWords. */
                public correctWords: string;

                /** Corpus regexCorrectTableId. */
                public regexCorrectTableId: string;

                /** Corpus regexCorrectTableName. */
                public regexCorrectTableName: string;

                /** Corpus glossaryTableId. */
                public glossaryTableId: string;

                /** Corpus glossaryTableName. */
                public glossaryTableName: string;

                /** Corpus showMatchHotWords. */
                public showMatchHotWords?: (boolean|null);

                /** Corpus showAllMatchHotWords. */
                public showAllMatchHotWords?: (boolean|null);

                /** Corpus showEffectiveHotWords. */
                public showEffectiveHotWords?: (boolean|null);

                /**
                 * Encodes the specified Corpus message. Does not implicitly {@link data.speech.understanding.Corpus.verify|verify} messages.
                 * @param message Corpus message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: data.speech.understanding.ICorpus, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a Corpus message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns Corpus
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): data.speech.understanding.Corpus;

                /**
                 * Gets the default type url for Corpus
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }
        }
    }
}
