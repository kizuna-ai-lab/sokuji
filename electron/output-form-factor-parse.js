// Pure parsers that turn native audio-device listings into OutputDeviceInfo
// records ({ label, isDefault, formFactor, transport, raw }). No electron
// require and no I/O, so they can be tested against captured fixtures.

const MAX_RAW_KEYS = 12;
const MAX_RAW_STRING = 120;

// raw crosses IPC and lands in a diagnostic log; keep it small and flat.
function capRaw(raw) {
  const out = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw || {})) {
    if (count >= MAX_RAW_KEYS) break;
    const type = typeof value;
    if (type === 'string') {
      out[key] = value.length > MAX_RAW_STRING ? value.slice(0, MAX_RAW_STRING) : value;
    } else if (type === 'number' || type === 'boolean') {
      out[key] = value;
    } else {
      continue;
    }
    count++;
  }
  return out;
}

function isHdmiPort(portName, portType) {
  return portType === 'HDMI' || (typeof portName === 'string' && portName.startsWith('hdmi-output'));
}

// PipeWire before 1.0 (0.3.48 on Ubuntu 22.04) leaves device.bus on the card,
// not on its sinks. A sink names its card by PipeWire object id (its device.id
// is the card's object.id, a property - not the card's index) and, for ALSA,
// by card number (api.alsa.pcm.card or alsa.card = the card's alsa.card).
// Only device.bus counts: a USB card's device.bus_path starts with "pci-".
// `cards` holds only cards that state a device.bus, so a sink whose card has
// none finds no match by object id and falls to the card number, which names
// the same card: still no bus, so 'unknown'. A card number match is refused
// for a card naming another object id than the sink's: a card replaced
// between the sinks and cards reads can hand its number to another card.
function cardBus(props, cards) {
  if (!Array.isArray(cards)) return undefined;
  const id = props['device.id'];
  const alsa = props['api.alsa.pcm.card'] ?? props['alsa.card'];
  const byId = id !== undefined && cards.find((c) => c.objectId === id);
  if (byId) return byId.bus;
  const byNumber = alsa !== undefined && cards.find((c) => c.alsaCard === alsa);
  if (!byNumber || (id !== undefined && byNumber.objectId !== undefined)) return undefined;
  return byNumber.bus;
}

// Rules run in order; the first that applies wins. Anything the system does
// not state plainly stays 'unknown' (no guessing from the label).
function classifySink({ name, description, driver, properties, activePort, portType }, defaultSinkName, cards) {
  const props = properties || {};
  // PipeWire names the null sink's factory; plain PulseAudio has no factory.name
  // and names the module that made it as the driver instead.
  const isNull = props['factory.name'] === 'support.null-audio-sink' || driver === 'module-null-sink.c';
  const hdmi = isHdmiPort(activePort, portType);
  const hintForm = props['device.form_factor'];
  const bus = props['device.bus'] ?? cardBus(props, cards);

  let formFactor = 'unknown';
  if (isNull) {
    formFactor = 'unknown';
  } else if (portType === 'Headphones' || portType === 'Headset') {
    formFactor = 'headphones';
  } else if (portType === 'Speaker') {
    formFactor = 'speakers';
  } else if (activePort === 'analog-output-headphones') {
    formFactor = 'headphones';
  } else if (activePort === 'analog-output-speaker') {
    formFactor = 'speakers';
  } else if (hdmi) {
    formFactor = 'unknown';
  } else if (['headphone', 'headset', 'hands-free', 'handset'].includes(hintForm)) {
    formFactor = 'headphones';
  } else if (hintForm === 'speaker') {
    formFactor = 'speakers';
  }

  let transport = 'unknown';
  if (isNull) transport = 'virtual';
  else if (hdmi) transport = 'hdmi';
  else if (bus === 'pci') transport = 'builtin';
  else if (bus === 'usb') transport = 'usb';
  else if (bus === 'bluetooth') transport = 'bluetooth';

  const rawSource = {
    name,
    activePort,
    portType,
    formFactor: hintForm,
    bus,
    factory: props['factory.name'],
  };
  const raw = {};
  for (const [k, v] of Object.entries(rawSource)) {
    if (v !== undefined && v !== null) raw[k] = v;
  }

  return {
    label: typeof description === 'string' ? chromiumRedactedLabel(description) : description,
    isDefault: name === defaultSinkName,
    formFactor,
    transport,
    raw: capRaw(raw),
  };
}

function parseJsonArray(text) {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// `cards` (from parsePactlCards*) only fill in a bus a sink leaves out.
function parsePactlSinksJson(text, defaultSinkName, cards) {
  const sinks = parseJsonArray(text);
  if (!sinks) return null;
  return sinks
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      const ports = Array.isArray(s.ports) ? s.ports : [];
      const port = ports.find((p) => p && p.name === s.active_port);
      return classifySink(
        {
          name: s.name,
          description: s.description,
          driver: s.driver,
          properties: s.properties,
          activePort: s.active_port || undefined,
          portType: port && port.type ? port.type : undefined,
        },
        defaultSinkName,
        cards
      );
    });
}

// Text form of `LC_ALL=C pactl list sinks` (or cards): top-level keys at one
// tab, properties and ports at two tabs. Old PulseAudio prints ports without
// "type:", so the type is optional. A card's port properties sit deeper and
// are skipped.
function parsePactlTextBlocks(text, header) {
  const blocks = [];
  let cur = null;
  let section = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (header.test(line)) {
      cur = { properties: {}, ports: {} };
      blocks.push(cur);
      section = null;
      continue;
    }
    if (!cur) continue;
    let m;
    if ((m = /^\t([^\t].*?):\s*(.*)$/.exec(line))) {
      const key = m[1];
      const value = m[2];
      section = key === 'Properties' || key === 'Ports' ? key : null;
      if (key === 'Name') cur.name = value;
      else if (key === 'Description') cur.description = value;
      else if (key === 'Driver') cur.driver = value;
      else if (key === 'Active Port') cur.activePort = value;
      continue;
    }
    if (!/^\t\t/.test(line)) continue;
    if (section === 'Properties') {
      if ((m = /^\t\t(\S+) = "(.*)"$/.exec(line))) cur.properties[m[1]] = m[2];
    } else if (section === 'Ports') {
      if ((m = /^\t\t([^:\s][^:]*): .*$/.exec(line))) {
        const t = /\(type: ([^,)]+)/.exec(line);
        cur.ports[m[1]] = t ? t[1] : undefined;
      }
    }
  }
  return blocks;
}

function parsePactlSinksText(text, defaultSinkName, cards) {
  return parsePactlTextBlocks(text, /^Sink #\d+/).map((b) =>
    classifySink(
      {
        name: b.name,
        description: b.description,
        driver: b.driver,
        properties: b.properties,
        activePort: b.activePort || undefined,
        portType: b.activePort ? b.ports[b.activePort] : undefined,
      },
      defaultSinkName,
      cards
    )
  );
}

// `pactl list cards` -> [{ objectId, alsaCard, bus }] for the cards that state
// a device.bus; values stay the strings pactl prints.
function cardsFrom(propertyLists) {
  const cards = [];
  for (const props of propertyLists) {
    const bus = props && props['device.bus'];
    if (typeof bus !== 'string' || !bus) continue;
    cards.push({ objectId: props['object.id'], alsaCard: props['alsa.card'], bus });
  }
  return cards;
}

function parsePactlCardsJson(text) {
  const cards = parseJsonArray(text);
  return cards ? cardsFrom(cards.map((c) => (c && typeof c === 'object' ? c.properties : null))) : null;
}

function parsePactlCardsText(text) {
  return cardsFrom(parsePactlTextBlocks(text, /^Card #\d+/).map((b) => b.properties));
}

function parsePactlDefaultSink(text, json) {
  if (json) {
    try {
      const info = JSON.parse(text);
      const name = info && info.default_sink_name;
      return typeof name === 'string' && name ? name : null;
    } catch {
      return null;
    }
  }
  const m = /^Default Sink: (.+)$/m.exec(String(text));
  return m ? m[1].trim() : null;
}

// `--devices` of the macOS helper: one JSON array. A four-char code arrives as
// a string when its bytes are printable ASCII and as a number otherwise.
const MAC_TRANSPORT = {
  bltn: 'builtin',
  blue: 'bluetooth',
  blea: 'bluetooth',
  hdmi: 'hdmi',
  dprt: 'hdmi',
  usb: 'usb',
  virt: 'virtual',
  grup: 'virtual',
};

// Codes compare trimmed ('usb ' has a trailing space); numbers compare as is.
function macCode(value) {
  return typeof value === 'string' ? value.trim() : value;
}

// Output terminal types, read for Bluetooth and USB outputs: Core Audio's
// AudioHardwareBase.h (four-char codes) and the USB Audio terminal types in
// IOAudioTypes.h (numbers). A USB headset was measured reporting 'hdph'. Anything
// not listed, or none, stays unknown, including 'spdf' and 'line', which say
// nothing about what is plugged in, and 0x0303, a head-mounted display.
const MAC_TERMINAL_HEADPHONES = new Set([
  'hdph', // kAudioStreamTerminalTypeHeadphones
  'rspk', // kAudioStreamTerminalTypeReceiverSpeaker
  0x0302, // OUTPUT_HEADPHONES
  0x0401, // BIDIRECTIONAL_HANDSET
  0x0402, // BIDIRECTIONAL_HEADSET
]);
const MAC_TERMINAL_SPEAKERS = new Set([
  'spkr', // kAudioStreamTerminalTypeSpeaker
  'lfes', // kAudioStreamTerminalTypeLFESpeaker
  0x0301, // OUTPUT_SPEAKER
  0x0304, // OUTPUT_DESKTOP_SPEAKER
  0x0305, // OUTPUT_ROOM_SPEAKER
  0x0306, // OUTPUT_COMMUNICATION_SPEAKER
  0x0307, // OUTPUT_LOW_FREQUENCY_EFFECTS_SPEAKER
  0x0403, // BIDIRECTIONAL_SPEAKERPHONE_NO_ECHO_REDX
  0x0404, // BIDIRECTIONAL_ECHO_SUPPRESSING_SPEAKERPHONE
  0x0405, // BIDIRECTIONAL_ECHO_CANCELING_SPEAKERPHONE
]);

function macFormFactor(transport, dataSource, terminalType) {
  if (transport === 'builtin') {
    if (dataSource === 'hdpn') return 'headphones';
    if (dataSource === 'ispk') return 'speakers';
  } else if (transport === 'bluetooth' || transport === 'usb') {
    // The system's word for what is attached: the output stream's terminal type.
    if (MAC_TERMINAL_HEADPHONES.has(terminalType)) return 'headphones';
    if (MAC_TERMINAL_SPEAKERS.has(terminalType)) return 'speakers';
  }
  return 'unknown';
}

// Chromium rewrites every output whose name holds "AirPods" before a page sees
// it, so the owner's name never reaches the page (Chromium 152,
// media/audio/audio_device_description.cc, RedactDeviceName, run by
// LocalizeDeviceDescriptions on every platform). The rule, as written there:
// only "AirPods" (case-sensitive) triggers it; a profile ("Hands-Free AG
// Audio", else "Hands-Free", else "Stereo"), an English Windows form factor
// ("Headphones", else "Headset", which keeps the parentheses) and a
// "(Bluetooth)" suffix survive; everything else becomes "AirPods".
function chromiumRedactedLabel(name) {
  if (!name.includes('AirPods')) return name;
  let profile = '';
  if (name.includes('Hands-Free AG Audio')) profile = ' Hands-Free AG Audio';
  else if (name.includes('Hands-Free')) profile = ' Hands-Free';
  else if (name.includes('Stereo')) profile = ' Stereo';
  let formFactor = null;
  if (name.includes('Headphones')) formFactor = 'Headphones';
  else if (name.includes('Headset')) formFactor = 'Headset';
  const suffix = name.includes('(Bluetooth)') ? ' (Bluetooth)' : '';
  const base = `AirPods${profile}`;
  return formFactor ? `${formFactor} (${base})${suffix}` : `${base}${suffix}`;
}

// A helper row's label: the one the browser shows when the helper built it,
// else the system's device name, else empty; then Chromium's AirPods rewrite.
function helperLabel(r) {
  if (typeof r.browserLabel === 'string' && r.browserLabel) return chromiumRedactedLabel(r.browserLabel);
  return typeof r.label === 'string' ? chromiumRedactedLabel(r.label) : '';
}

function parseMacDevices(text) {
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  return rows
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      const code = macCode(r.transport);
      const transport = (typeof code === 'string' && MAC_TRANSPORT[code]) || 'unknown';
      const dataSource = macCode(r.dataSource);
      const terminalType = macCode(r.terminalType);
      // No uid: a Bluetooth device's UID is its MAC address, and raw lands in a log.
      const raw = { name: r.label, transport: r.transport, dataSource: r.dataSource, terminalType: r.terminalType };
      for (const k of ['transport', 'dataSource', 'terminalType']) {
        if (typeof raw[k] === 'number') raw[k] = String(raw[k]);
      }
      return {
        // The label the browser shows for this output, so the two match exactly.
        label: helperLabel(r),
        isDefault: r.isDefault === true,
        formFactor: macFormFactor(transport, dataSource, terminalType),
        transport,
        raw: capRaw(raw),
      };
    });
}

// `--devices` of the Windows helper: one JSON array. formFactor is
// PKEY_AudioEndpoint_FormFactor (the EndpointFormFactor enum) or null;
// enumerator is PKEY_Device_EnumeratorName or null; browserLabel is the
// friendly name with the suffix Chromium appends (" (0951:16a4)" for USB,
// " (Bluetooth)" for Bluetooth).
const WIN_FORM_SPEAKERS = 1;
const WIN_FORM_DIGITAL_DISPLAY = 9; // DigitalAudioDisplayDevice: a monitor or TV over HDMI/DisplayPort
const WIN_FORM_HEADPHONES = new Set([3, 5, 6]); // Headphones, Headset, Handset

const WIN_TRANSPORT = {
  BTHENUM: 'bluetooth',
  BTHHFENUM: 'bluetooth',
  USB: 'usb',
  SWD: 'virtual',
  ROOT: 'virtual',
};

function winTransport(enumerator, formFactor) {
  const name = typeof enumerator === 'string' ? enumerator.toUpperCase() : '';
  if (name === 'HDAUDIO') return formFactor === WIN_FORM_DIGITAL_DISPLAY ? 'hdmi' : 'builtin';
  return WIN_TRANSPORT[name] || 'unknown';
}

function parseWinDevices(text) {
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  return rows
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      const form = typeof r.formFactor === 'number' ? r.formFactor : null;
      const transport = winTransport(r.enumerator, form);
      // A virtual device's form factor describes no hardware (VB-CABLE says Speakers).
      let formFactor = 'unknown';
      if (transport !== 'virtual') {
        if (form === WIN_FORM_SPEAKERS) formFactor = 'speakers';
        else if (WIN_FORM_HEADPHONES.has(form)) formFactor = 'headphones';
      }
      return {
        // The label the browser shows for this output, so the two match exactly.
        label: helperLabel(r),
        isDefault: r.isDefault === true,
        formFactor,
        transport,
        raw: capRaw({ id: r.id, name: r.label, formFactor: r.formFactor, enumerator: r.enumerator }),
      };
    });
}

module.exports = {
  MAX_RAW_KEYS,
  MAX_RAW_STRING,
  capRaw,
  parsePactlSinksJson,
  parsePactlSinksText,
  parsePactlCardsJson,
  parsePactlCardsText,
  parsePactlDefaultSink,
  parseMacDevices,
  parseWinDevices,
  chromiumRedactedLabel,
};
