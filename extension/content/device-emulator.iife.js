(function () {
  'use strict';

  MediaStreamTrack.prototype.getCapabilities = MediaStreamTrack.prototype.getCapabilities || function getCapabilitiesPlaceholder() {
    return {};
  };

  const originalSetSinkId = HTMLAudioElement.prototype.setSinkId;
  class NewHTMLAudioElement {
    async setSinkId(sinkId) {
      const deviceMeta = navigator.mediaDevices.meta?.[sinkId];
      if (deviceMeta?.device.kind === "audiooutput") {
        this.sinkId = sinkId;
        return;
      }
      await originalSetSinkId.call(this, sinkId);
    }
  }
  HTMLAudioElement.prototype.setSinkId = NewHTMLAudioElement.prototype.setSinkId;

  var isMergeableObject = function isMergeableObject(value) {
    return isNonNullObject(value)
      && !isSpecial(value)
  };

  function isNonNullObject(value) {
    return !!value && typeof value === 'object'
  }

  function isSpecial(value) {
    var stringValue = Object.prototype.toString.call(value);

    return stringValue === '[object RegExp]'
      || stringValue === '[object Date]'
      || isReactElement(value)
  }

  // see https://github.com/facebook/react/blob/b5ac963fb791d1298e7f396236383bc955f916c1/src/isomorphic/classic/element/ReactElement.js#L21-L25
  var canUseSymbol = typeof Symbol === 'function' && Symbol.for;
  var REACT_ELEMENT_TYPE = canUseSymbol ? Symbol.for('react.element') : 0xeac7;

  function isReactElement(value) {
    return value.$$typeof === REACT_ELEMENT_TYPE
  }

  function emptyTarget(val) {
    return Array.isArray(val) ? [] : {}
  }

  function cloneUnlessOtherwiseSpecified(value, options) {
    return (options.clone !== false && options.isMergeableObject(value))
      ? deepmerge(emptyTarget(value), value, options)
      : value
  }

  function defaultArrayMerge(target, source, options) {
    return target.concat(source).map(function(element) {
      return cloneUnlessOtherwiseSpecified(element, options)
    })
  }

  function getMergeFunction(key, options) {
    if (!options.customMerge) {
      return deepmerge
    }
    var customMerge = options.customMerge(key);
    return typeof customMerge === 'function' ? customMerge : deepmerge
  }

  function getEnumerableOwnPropertySymbols(target) {
    return Object.getOwnPropertySymbols
      ? Object.getOwnPropertySymbols(target).filter(function(symbol) {
        return target.propertyIsEnumerable(symbol)
      })
      : []
  }

  function getKeys(target) {
    return Object.keys(target).concat(getEnumerableOwnPropertySymbols(target))
  }

  function propertyIsOnObject(object, property) {
    try {
      return property in object
    } catch(_) {
      return false
    }
  }

  // Protects from prototype poisoning and unexpected merging up the prototype chain.
  function propertyIsUnsafe(target, key) {
    return propertyIsOnObject(target, key) // Properties are safe to merge if they don't exist in the target yet,
      && !(Object.hasOwnProperty.call(target, key) // unsafe if they exist up the prototype chain,
        && Object.propertyIsEnumerable.call(target, key)) // and also unsafe if they're nonenumerable.
  }

  function mergeObject(target, source, options) {
    var destination = {};
    if (options.isMergeableObject(target)) {
      getKeys(target).forEach(function(key) {
        destination[key] = cloneUnlessOtherwiseSpecified(target[key], options);
      });
    }
    getKeys(source).forEach(function(key) {
      if (propertyIsUnsafe(target, key)) {
        return
      }

      if (propertyIsOnObject(target, key) && options.isMergeableObject(source[key])) {
        destination[key] = getMergeFunction(key, options)(target[key], source[key], options);
      } else {
        destination[key] = cloneUnlessOtherwiseSpecified(source[key], options);
      }
    });
    return destination
  }

  function deepmerge(target, source, options) {
    options = options || {};
    options.arrayMerge = options.arrayMerge || defaultArrayMerge;
    options.isMergeableObject = options.isMergeableObject || isMergeableObject;
    // cloneUnlessOtherwiseSpecified is added to `options` so that custom arrayMerge()
    // implementations can use it. The caller may not replace it.
    options.cloneUnlessOtherwiseSpecified = cloneUnlessOtherwiseSpecified;

    var sourceIsArray = Array.isArray(source);
    var targetIsArray = Array.isArray(target);
    var sourceAndTargetTypesMatch = sourceIsArray === targetIsArray;

    if (!sourceAndTargetTypesMatch) {
      return cloneUnlessOtherwiseSpecified(source, options)
    } else if (sourceIsArray) {
      return options.arrayMerge(target, source, options)
    } else {
      return mergeObject(target, source, options)
    }
  }

  deepmerge.all = function deepmergeAll(array, options) {
    if (!Array.isArray(array)) {
      throw new Error('first argument should be an array')
    }

    return array.reduce(function(prev, next) {
      return deepmerge(prev, next, options)
    }, {})
  };

  var deepmerge_1 = deepmerge;

  var cjs = deepmerge_1;

  function extractConstraintProperty(constraints, property) {
    const exactProperty = constraints[property]?.exact;
    const idealProperty = constraints[property]?.ideal;
    const p = constraints[property];
    return exactProperty ?? idealProperty ?? p;
  }

  function extractDeviceId(constraints, replace) {
    const extractLegacyDeviceId = (key) => {
      if (!constraints[key]) {
        return null;
      }
      if (Array.isArray(constraints[key])) {
        const legacyDeviceIdIndex = constraints[key].findIndex((c) => c.sourceId);
        if (legacyDeviceIdIndex === -1) {
          return null;
        }
        const legacyDeviceId2 = constraints[key][legacyDeviceIdIndex];
        const { sourceId: sourceId2 } = legacyDeviceId2;
        if (replace) {
          if (Object.keys(legacyDeviceId2).length === 1) {
            replace[key] = constraints[key].splice(legacyDeviceIdIndex, 1);
          } else {
            replace[key] = [{ sourceId: legacyDeviceId2.sourceId }];
            delete legacyDeviceId2.sourceId;
          }
        }
        return sourceId2;
      }
      const legacyDeviceId = constraints[key];
      const { sourceId } = legacyDeviceId;
      if (!sourceId) {
        return null;
      }
      if (replace) {
        replace[key] = { sourceId: legacyDeviceId.sourceId };
        delete legacyDeviceId.sourceId;
      }
      return sourceId;
    };
    const mandatoryLegacyDeviceId = extractLegacyDeviceId("mandatory");
    if (mandatoryLegacyDeviceId) {
      return mandatoryLegacyDeviceId;
    }
    const optionalLegacyDeviceId = extractLegacyDeviceId("optional");
    if (optionalLegacyDeviceId) {
      return optionalLegacyDeviceId;
    }
    const deviceId = extractConstraintProperty(constraints, "deviceId");
    if (replace) {
      replace.deviceId = constraints.deviceId;
      delete constraints.deviceId;
    }
    return deviceId;
  }

  function evaluateDeviceIdConstraint(realConstraints, emulatedConstraints, kind, meta) {
    const constraints = realConstraints[kind];
    if (!constraints) {
      return null;
    }
    const deviceId = extractDeviceId(constraints);
    if (!deviceId) {
      return null;
    }
    const deviceMeta = meta[deviceId];
    if (deviceMeta?.device.kind !== `${kind}input`) {
      return null;
    }
    if (deviceMeta.fail) {
      throw new TypeError(`NotReadableError: Failed to allocate ${kind}source`);
    }
    emulatedConstraints[kind] = realConstraints[kind];
    delete realConstraints[kind];
    return deviceId;
  }

  function createAudioStream(props) {
    const ctx = new AudioContext();
    const osc = new OscillatorNode(ctx);
    const gain = new GainNode(ctx, { gain: +!props.silent });
    const dest = new MediaStreamAudioDestinationNode(ctx);
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    props.eventTarget.addEventListener("toggleSilence", () => {
      gain.gain.value = +!props.silent;
    });
    return dest.stream;
  }

  const createCache = (lastNumberWeakMap) => {
      return (collection, nextNumber) => {
          lastNumberWeakMap.set(collection, nextNumber);
          return nextNumber;
      };
  };

  /*
   * The value of the constant Number.MAX_SAFE_INTEGER equals (2 ** 53 - 1) but it
   * is fairly new.
   */
  const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER === undefined ? 9007199254740991 : Number.MAX_SAFE_INTEGER;
  const TWO_TO_THE_POWER_OF_TWENTY_NINE = 536870912;
  const TWO_TO_THE_POWER_OF_THIRTY = TWO_TO_THE_POWER_OF_TWENTY_NINE * 2;
  const createGenerateUniqueNumber = (cache, lastNumberWeakMap) => {
      return (collection) => {
          const lastNumber = lastNumberWeakMap.get(collection);
          /*
           * Let's try the cheapest algorithm first. It might fail to produce a new
           * number, but it is so cheap that it is okay to take the risk. Just
           * increase the last number by one or reset it to 0 if we reached the upper
           * bound of SMIs (which stands for small integers). When the last number is
           * unknown it is assumed that the collection contains zero based consecutive
           * numbers.
           */
          let nextNumber = lastNumber === undefined ? collection.size : lastNumber < TWO_TO_THE_POWER_OF_THIRTY ? lastNumber + 1 : 0;
          if (!collection.has(nextNumber)) {
              return cache(collection, nextNumber);
          }
          /*
           * If there are less than half of 2 ** 30 numbers stored in the collection,
           * the chance to generate a new random number in the range from 0 to 2 ** 30
           * is at least 50%. It's benifitial to use only SMIs because they perform
           * much better in any environment based on V8.
           */
          if (collection.size < TWO_TO_THE_POWER_OF_TWENTY_NINE) {
              while (collection.has(nextNumber)) {
                  nextNumber = Math.floor(Math.random() * TWO_TO_THE_POWER_OF_THIRTY);
              }
              return cache(collection, nextNumber);
          }
          // Quickly check if there is a theoretical chance to generate a new number.
          if (collection.size > MAX_SAFE_INTEGER) {
              throw new Error('Congratulations, you created a collection of unique numbers which uses all available integers!');
          }
          // Otherwise use the full scale of safely usable integers.
          while (collection.has(nextNumber)) {
              nextNumber = Math.floor(Math.random() * MAX_SAFE_INTEGER);
          }
          return cache(collection, nextNumber);
      };
  };

  const LAST_NUMBER_WEAK_MAP = new WeakMap();
  const cache = createCache(LAST_NUMBER_WEAK_MAP);
  const generateUniqueNumber = createGenerateUniqueNumber(cache, LAST_NUMBER_WEAK_MAP);

  const isCallNotification = (message) => {
      return message.method !== undefined && message.method === 'call';
  };

  const isClearResponse = (message) => {
      return message.error === null && typeof message.id === 'number';
  };

  const load = (url) => {
      // Prefilling the Maps with a function indexed by zero is necessary to be compliant with the specification.
      const scheduledIntervalFunctions = new Map([[0, () => { }]]); // tslint:disable-line no-empty
      const scheduledTimeoutFunctions = new Map([[0, () => { }]]); // tslint:disable-line no-empty
      const unrespondedRequests = new Map();
      const worker = new Worker(url);
      worker.addEventListener('message', ({ data }) => {
          if (isCallNotification(data)) {
              const { params: { timerId, timerType } } = data;
              if (timerType === 'interval') {
                  const idOrFunc = scheduledIntervalFunctions.get(timerId);
                  if (typeof idOrFunc === 'number') {
                      const timerIdAndTimerType = unrespondedRequests.get(idOrFunc);
                      if (timerIdAndTimerType === undefined ||
                          timerIdAndTimerType.timerId !== timerId ||
                          timerIdAndTimerType.timerType !== timerType) {
                          throw new Error('The timer is in an undefined state.');
                      }
                  }
                  else if (typeof idOrFunc !== 'undefined') {
                      idOrFunc();
                  }
                  else {
                      throw new Error('The timer is in an undefined state.');
                  }
              }
              else if (timerType === 'timeout') {
                  const idOrFunc = scheduledTimeoutFunctions.get(timerId);
                  if (typeof idOrFunc === 'number') {
                      const timerIdAndTimerType = unrespondedRequests.get(idOrFunc);
                      if (timerIdAndTimerType === undefined ||
                          timerIdAndTimerType.timerId !== timerId ||
                          timerIdAndTimerType.timerType !== timerType) {
                          throw new Error('The timer is in an undefined state.');
                      }
                  }
                  else if (typeof idOrFunc !== 'undefined') {
                      idOrFunc();
                      // A timeout can be savely deleted because it is only called once.
                      scheduledTimeoutFunctions.delete(timerId);
                  }
                  else {
                      throw new Error('The timer is in an undefined state.');
                  }
              }
          }
          else if (isClearResponse(data)) {
              const { id } = data;
              const timerIdAndTimerType = unrespondedRequests.get(id);
              if (timerIdAndTimerType === undefined) {
                  throw new Error('The timer is in an undefined state.');
              }
              const { timerId, timerType } = timerIdAndTimerType;
              unrespondedRequests.delete(id);
              if (timerType === 'interval') {
                  scheduledIntervalFunctions.delete(timerId);
              }
              else {
                  scheduledTimeoutFunctions.delete(timerId);
              }
          }
          else {
              const { error: { message } } = data;
              throw new Error(message);
          }
      });
      const clearInterval = (timerId) => {
          const id = generateUniqueNumber(unrespondedRequests);
          unrespondedRequests.set(id, { timerId, timerType: 'interval' });
          scheduledIntervalFunctions.set(timerId, id);
          worker.postMessage({
              id,
              method: 'clear',
              params: { timerId, timerType: 'interval' }
          });
      };
      const clearTimeout = (timerId) => {
          const id = generateUniqueNumber(unrespondedRequests);
          unrespondedRequests.set(id, { timerId, timerType: 'timeout' });
          scheduledTimeoutFunctions.set(timerId, id);
          worker.postMessage({
              id,
              method: 'clear',
              params: { timerId, timerType: 'timeout' }
          });
      };
      const setInterval = (func, delay) => {
          const timerId = generateUniqueNumber(scheduledIntervalFunctions);
          scheduledIntervalFunctions.set(timerId, () => {
              func();
              // Doublecheck if the interval should still be rescheduled because it could have been cleared inside of func().
              if (typeof scheduledIntervalFunctions.get(timerId) === 'function') {
                  worker.postMessage({
                      id: null,
                      method: 'set',
                      params: {
                          delay,
                          now: performance.now(),
                          timerId,
                          timerType: 'interval'
                      }
                  });
              }
          });
          worker.postMessage({
              id: null,
              method: 'set',
              params: {
                  delay,
                  now: performance.now(),
                  timerId,
                  timerType: 'interval'
              }
          });
          return timerId;
      };
      const setTimeout = (func, delay) => {
          const timerId = generateUniqueNumber(scheduledTimeoutFunctions);
          scheduledTimeoutFunctions.set(timerId, func);
          worker.postMessage({
              id: null,
              method: 'set',
              params: {
                  delay,
                  now: performance.now(),
                  timerId,
                  timerType: 'timeout'
              }
          });
          return timerId;
      };
      return {
          clearInterval,
          clearTimeout,
          setInterval,
          setTimeout
      };
  };

  const createLoadOrReturnBroker = (loadBroker, worker) => {
      let broker = null;
      return () => {
          if (broker !== null) {
              return broker;
          }
          const blob = new Blob([worker], { type: 'application/javascript; charset=utf-8' });
          const url = URL.createObjectURL(blob);
          broker = loadBroker(url);
          // Bug #1: Edge up until v18 didn't like the URL to be revoked directly.
          setTimeout(() => URL.revokeObjectURL(url));
          return broker;
      };
  };

  // This is the minified and stringified code of the worker-timers-worker package.
  const worker = `(()=>{"use strict";const e=new Map,t=new Map,r=(e,t)=>{let r,o;const i=performance.now();r=i,o=e-Math.max(0,i-t);return{expected:r+o,remainingDelay:o}},o=(e,t,r,i)=>{const s=performance.now();s>r?postMessage({id:null,method:"call",params:{timerId:t,timerType:i}}):e.set(t,setTimeout(o,r-s,e,t,r,i))};addEventListener("message",(i=>{let{data:s}=i;try{if("clear"===s.method){const{id:r,params:{timerId:o,timerType:i}}=s;if("interval"===i)(t=>{const r=e.get(t);if(void 0===r)throw new Error('There is no interval scheduled with the given id "'.concat(t,'".'));clearTimeout(r),e.delete(t)})(o),postMessage({error:null,id:r});else{if("timeout"!==i)throw new Error('The given type "'.concat(i,'" is not supported'));(e=>{const r=t.get(e);if(void 0===r)throw new Error('There is no timeout scheduled with the given id "'.concat(e,'".'));clearTimeout(r),t.delete(e)})(o),postMessage({error:null,id:r})}}else{if("set"!==s.method)throw new Error('The given method "'.concat(s.method,'" is not supported'));{const{params:{delay:i,now:n,timerId:a,timerType:d}}=s;if("interval"===d)((t,i,s)=>{const{expected:n,remainingDelay:a}=r(t,s);e.set(i,setTimeout(o,a,e,i,n,"interval"))})(i,a,n);else{if("timeout"!==d)throw new Error('The given type "'.concat(d,'" is not supported'));((e,i,s)=>{const{expected:n,remainingDelay:a}=r(e,s);t.set(i,setTimeout(o,a,t,i,n,"timeout"))})(i,a,n)}}}}catch(e){postMessage({error:{message:e.message},id:s.id,result:null})}}))})();`; // tslint:disable-line:max-line-length

  const loadOrReturnBroker = createLoadOrReturnBroker(load, worker);
  const setInterval = (func, delay) => loadOrReturnBroker().setInterval(func, delay);

  function createVideoStream(props) {
    const canvas = document.createElement("canvas");
    const canvasFramePaintStartTime = new Date().getTime();
    const capabilities = props.device.getCapabilities();
    canvas.width = capabilities.width?.max ?? 640;
    canvas.height = capabilities.height?.max ?? 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new TypeError("UnknownError: an unknown error occurred");
    }
    const drawFrame = () => {
      if (!props.silent) {
        ctx.fillStyle = "green";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = "50px Arial";
        ctx.fillStyle = "blue";
        ctx.textAlign = "center";
        let secondsLapsed = new Date().getTime() - canvasFramePaintStartTime;
        secondsLapsed /= 100;
        secondsLapsed = Math.floor(secondsLapsed + 1e3);
        ctx.fillText(secondsLapsed.toString(), canvas.width / 2, canvas.height / 2);
      } else {
        ctx.fillStyle = "red";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    };
    setInterval(drawFrame, 100);
    return canvas.captureStream(capabilities.frameRate?.max);
  }

  function evaluateFacingModeConstraint(realConstraints, emulatedConstraints, props) {
    const allFacingModes = props.device.getCapabilities().facingMode;
    const facingMode = extractConstraintProperty(realConstraints, "facingMode");
    if (facingMode && allFacingModes?.includes(facingMode)) {
      emulatedConstraints.facingMode = realConstraints.facingMode;
      delete realConstraints.facingMode;
    }
  }

  function evaluateGroupIdConstraint(realConstraints, emulatedConstraints, props) {
    const groupId = extractConstraintProperty(realConstraints, "groupId");
    if (groupId === props.device.groupId) {
      emulatedConstraints.groupId = realConstraints.groupId;
      delete realConstraints.groupId;
    }
  }

  function extractTrack(stream) {
    const tracks = stream.getTracks();
    if (tracks.length !== 1) {
      throw new TypeError("UnknownError: an unknown error occurred");
    }
    return tracks[0];
  }

  async function registerMediaStreamTrack(deviceId, mediaStream, constraints, kind, meta) {
    const realConstraints = constraints[kind];
    const props = meta[deviceId];
    const stream = (kind === "audio" ? createAudioStream : createVideoStream)(props);
    const track = extractTrack(stream);
    const allFacingModes = props.device.getCapabilities().facingMode;
    let emulatedConstraints = {};
    extractDeviceId(realConstraints, emulatedConstraints);
    evaluateFacingModeConstraint(realConstraints, emulatedConstraints, props);
    evaluateGroupIdConstraint(realConstraints, emulatedConstraints, props);
    const originalConstraints = track.getConstraints();
    const trackConstraintsToApply = cjs(originalConstraints, realConstraints);
    try {
      await track.applyConstraints(trackConstraintsToApply);
    } catch (ex) {
      console.error(`DyteDeviceEmulator:: track.applyConstraints failed for ${JSON.stringify(trackConstraintsToApply)}`, ex);
    }
    const getConstraints = track.getConstraints.bind(track);
    const getSettings = track.getSettings.bind(track);
    const getCapabilities = track.getCapabilities.bind(track);
    const applyConstraints = track.applyConstraints.bind(track);
    track.getConstraints = () => cjs(getConstraints(), emulatedConstraints);
    track.getSettings = () => {
      const facingModeConstraint = extractConstraintProperty(emulatedConstraints, "facingMode");
      const defaultFacingMode = allFacingModes?.[0];
      return {
        ...getSettings(),
        deviceId,
        groupId: props.device.groupId,
        facingMode: facingModeConstraint ?? defaultFacingMode
      };
    };
    track.getCapabilities = () => ({
      ...getCapabilities(),
      deviceId,
      facingMode: allFacingModes,
      groupId: props.device.groupId
    });
    track.applyConstraints = async (mediaTrackConstraints) => {
      const newEmulatedConstraints = {};
      if (!mediaTrackConstraints) {
        await applyConstraints(mediaTrackConstraints);
        emulatedConstraints = newEmulatedConstraints;
        return;
      }
      const deviceIdConstraint = extractDeviceId(mediaTrackConstraints);
      if (deviceIdConstraint === deviceId) {
        extractDeviceId(mediaTrackConstraints, emulatedConstraints);
      }
      evaluateFacingModeConstraint(mediaTrackConstraints, newEmulatedConstraints, props);
      evaluateGroupIdConstraint(mediaTrackConstraints, newEmulatedConstraints, props);
      await applyConstraints(mediaTrackConstraints);
      emulatedConstraints = newEmulatedConstraints;
    };
    props.tracks.push(track);
    mediaStream.addTrack(track);
  }

  async function evaluateConstraints(originalFn, realConstraints, meta) {
    const emulatedConstraints = {};
    const audioDeviceId = evaluateDeviceIdConstraint(realConstraints, emulatedConstraints, "audio", meta);
    const videoDeviceId = evaluateDeviceIdConstraint(realConstraints, emulatedConstraints, "video", meta);
    if (Object.keys(emulatedConstraints).length === 0) {
      const stream = await originalFn(realConstraints);
      return stream;
    }
    const audioProps = audioDeviceId ? meta[audioDeviceId] : null;
    const videoProps = videoDeviceId ? meta[videoDeviceId] : null;
    const hasAudioCustomStream = audioProps?.customStream;
    const hasVideoCustomStream = videoProps?.customStream;
    if (hasAudioCustomStream || hasVideoCustomStream) {
      let mediaStream2;
      if (hasAudioCustomStream && hasVideoCustomStream) {
        mediaStream2 = new MediaStream();
        const audioTracks = audioProps.customStream.getAudioTracks();
        const videoTracks = videoProps.customStream.getVideoTracks();
        audioTracks.forEach((track) => mediaStream2.addTrack(track));
        videoTracks.forEach((track) => mediaStream2.addTrack(track));
      } else if (hasAudioCustomStream) {
        mediaStream2 = audioProps.customStream.clone();
        if (videoDeviceId) {
          await registerMediaStreamTrack(videoDeviceId, mediaStream2, emulatedConstraints, "video", meta);
        }
      } else {
        mediaStream2 = videoProps.customStream.clone();
        if (audioDeviceId) {
          await registerMediaStreamTrack(audioDeviceId, mediaStream2, emulatedConstraints, "audio", meta);
        }
      }
      return mediaStream2;
    }
    const mediaStream = new MediaStream();
    if (audioDeviceId) {
      await registerMediaStreamTrack(audioDeviceId, mediaStream, emulatedConstraints, "audio", meta);
    }
    if (videoDeviceId) {
      await registerMediaStreamTrack(videoDeviceId, mediaStream, emulatedConstraints, "video", meta);
    }
    if (realConstraints.audio || realConstraints.video) {
      const stream = await originalFn(realConstraints);
      stream.getTracks().forEach((track) => {
        mediaStream.addTrack(track);
      });
    }
    return mediaStream;
  }

  function getEmulatedAudioDeviceCapabilities() {
    const ctx = new AudioContext();
    const { stream: audioStream } = new MediaStreamAudioDestinationNode(ctx);
    const audioTrack = extractTrack(audioStream);
    const audioCapabilities = audioTrack.getCapabilities();
    audioTrack.stop();
    return audioCapabilities;
  }

  function getEmulatedVideoDeviceCapabilities() {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new TypeError("UnknownError: an unknown error occurred");
    }
    const videoStream = canvas.captureStream();
    const videoTrack = extractTrack(videoStream);
    const videoCapabilities = videoTrack.getCapabilities();
    videoTrack.stop();
    return videoCapabilities;
  }

  const originalEnumerateDevices = MediaDevices.prototype.enumerateDevices;
  const originalGetDisplayMedia = MediaDevices.prototype.getDisplayMedia;
  const originalGetUserMedia = MediaDevices.prototype.getUserMedia;
  class NewMediaDevices {
    async enumerateDevices() {
      const realDevices = await originalEnumerateDevices.call(this);
      if (!this.meta) {
        return realDevices;
      }
      const deviceIds = Object.keys(this.meta);
      const emulatedDevices = deviceIds.map((deviceId) => this.meta[deviceId].device);
      return emulatedDevices.concat(realDevices);
    }
    async getDisplayMedia(constraints) {
      const originalFn = originalGetDisplayMedia.bind(this);
      if (!constraints || !this.meta) {
        const mediaStream2 = await originalFn(constraints);
        return mediaStream2;
      }
      if (!constraints.video) {
        constraints.video = true;
      }
      const mediaStream = await evaluateConstraints(originalFn, constraints, this.meta);
      return mediaStream;
    }
    async getUserMedia(constraints) {
      const originalFn = originalGetUserMedia.bind(this);
      if (!constraints || !this.meta) {
        const mediaStream2 = await originalFn(constraints);
        return mediaStream2;
      }
      const mediaStream = await evaluateConstraints(originalFn, constraints, this.meta);
      return mediaStream;
    }
    addEmulatedDevice(kind, capabilities, options) {
      const deviceId = options?.deviceId || crypto.randomUUID();
      const label = options?.label || `Emulated device of ${kind} kind - ${deviceId}`;
      const groupId = options?.groupId || "emulated-device-group";
      const customStream = options?.stream;
      if (this.meta && this.meta[deviceId]) {
        throw new Error(`Device with deviceId "${deviceId}" already exists`);
      }
      const device = { deviceId, kind, label, groupId, toJSON: () => device };
      if (kind === "audioinput" || kind === "videoinput") {
        if (typeof InputDeviceInfo !== "undefined") {
          Object.setPrototypeOf(device, InputDeviceInfo.prototype);
        }
        const defaultCapabilities = kind === "audioinput" ? this.emulatedAudioDeviceCapabilities : this.emulatedVideoDeviceCapabilities;
        const totalCapabilities = capabilities ? cjs(defaultCapabilities, capabilities) : defaultCapabilities;
        device.getCapabilities = () => ({
          ...totalCapabilities,
          deviceId: device.deviceId,
          groupId: device.groupId
        });
      } else {
        Object.setPrototypeOf(device, MediaDeviceInfo.prototype);
      }
      let tracks = [];
      if (customStream) {
        if (kind === "videoinput") {
          tracks = customStream.getVideoTracks();
        } else if (kind === "audioinput") {
          tracks = customStream.getAudioTracks();
        }
      }
      const meta = {
        tracks,
        fail: false,
        silent: false,
        device,
        eventTarget: new EventTarget(),
        customStream
      };
      if (!this.meta) {
        this.meta = { [device.deviceId]: meta };
      } else {
        this.meta[device.deviceId] = meta;
      }
      this.dispatchEvent(new Event("devicechange"));
      return deviceId;
    }
    failDevice(emulatorDeviceId, fail) {
      const deviceMeta = this.meta?.[emulatorDeviceId];
      if (!deviceMeta) {
        return false;
      }
      deviceMeta.tracks.forEach((track) => {
        track.stop();
        track.dispatchEvent(new Event("ended"));
      });
      deviceMeta.fail = fail;
      deviceMeta.tracks.length = 0;
      if (this.meta) {
        this.meta[emulatorDeviceId] = deviceMeta;
      }
      return true;
    }
    removeEmulatedDevice(emulatorDeviceId) {
      const deviceMeta = this.meta?.[emulatorDeviceId];
      if (!deviceMeta) {
        return false;
      }
      deviceMeta.tracks.forEach((track) => {
        track.stop();
        track.dispatchEvent(new Event("ended"));
      });
      delete this.meta[emulatorDeviceId];
      this.dispatchEvent(new Event("devicechange"));
      return true;
    }
    silenceDevice(emulatorDeviceId, silent) {
      const deviceMeta = this.meta?.[emulatorDeviceId];
      if (!deviceMeta) {
        return false;
      }
      deviceMeta.silent = silent;
      deviceMeta.eventTarget.dispatchEvent(new Event("toggleSilence"));
      return true;
    }
  }
  MediaDevices.prototype.enumerateDevices = NewMediaDevices.prototype.enumerateDevices;
  MediaDevices.prototype.getDisplayMedia = NewMediaDevices.prototype.getDisplayMedia;
  MediaDevices.prototype.getUserMedia = NewMediaDevices.prototype.getUserMedia;
  MediaDevices.prototype.addEmulatedDevice = NewMediaDevices.prototype.addEmulatedDevice;
  MediaDevices.prototype.failDevice = NewMediaDevices.prototype.failDevice;
  MediaDevices.prototype.removeEmulatedDevice = NewMediaDevices.prototype.removeEmulatedDevice;
  MediaDevices.prototype.silenceDevice = NewMediaDevices.prototype.silenceDevice;
  MediaDevices.prototype.emulatedAudioDeviceCapabilities = getEmulatedAudioDeviceCapabilities();
  MediaDevices.prototype.emulatedVideoDeviceCapabilities = getEmulatedVideoDeviceCapabilities();

  window.dispatchEvent(new Event("dyte.deviceEmulatorLoaded"));

})();
