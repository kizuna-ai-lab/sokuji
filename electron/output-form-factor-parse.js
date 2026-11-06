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

// Rules run in order; the first that applies wins. Anything the system does
// not state plainly stays 'unknown' (no guessing from the label).
function classifySink({ name, description, properties, activePort, portType }, defaultSinkName) {
  const props = properties || {};
  const isNull = props['factory.name'] === 'support.null-audio-sink';
  const hdmi = isHdmiPort(activePort, portType);
  const hintForm = props['device.form_factor'];
  const bus = props['device.bus'];

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
    label: description,
    isDefault: name === defaultSinkName,
    formFactor,
    transport,
    raw: capRaw(raw),
  };
}

function parsePactlSinksJson(text, defaultSinkName) {
  let sinks;
  try {
    sinks = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(sinks)) return null;
  return sinks
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      const ports = Array.isArray(s.ports) ? s.ports : [];
      const port = ports.find((p) => p && p.name === s.active_port);
      return classifySink(
        {
          name: s.name,
          description: s.description,
          properties: s.properties,
          activePort: s.active_port || undefined,
          portType: port && port.type ? port.type : undefined,
        },
        defaultSinkName
      );
    });
}

// Text form of `LC_ALL=C pactl list sinks`: top-level keys at one tab,
// properties and ports at two tabs. Old PulseAudio prints ports without
// "type:", so the type is optional.
function parsePactlSinksText(text, defaultSinkName) {
  const blocks = [];
  let cur = null;
  let section = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^Sink #\d+/.test(line)) {
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
  return blocks.map((b) =>
    classifySink(
      {
        name: b.name,
        description: b.description,
        properties: b.properties,
        activePort: b.activePort || undefined,
        portType: b.activePort ? b.ports[b.activePort] : undefined,
      },
      defaultSinkName
    )
  );
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

function macFormFactor(transport, dataSource, terminalType) {
  if (transport === 'builtin') {
    if (dataSource === 'hdpn') return 'headphones';
    if (dataSource === 'ispk') return 'speakers';
  } else if (transport === 'bluetooth') {
    if (terminalType === 'hdph' || terminalType === 0x0302 || terminalType === 0x0402) return 'headphones';
    if (terminalType === 'spkr' || terminalType === 0x0301) return 'speakers';
  }
  return 'unknown';
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
      const raw = { uid: r.uid, transport: r.transport, dataSource: r.dataSource, terminalType: r.terminalType };
      for (const k of ['transport', 'dataSource', 'terminalType']) {
        if (typeof raw[k] === 'number') raw[k] = String(raw[k]);
      }
      return {
        label: r.label,
        isDefault: r.isDefault === true,
        formFactor: macFormFactor(transport, dataSource, terminalType),
        transport,
        raw: capRaw(raw),
      };
    });
}

module.exports = {
  MAX_RAW_KEYS,
  MAX_RAW_STRING,
  capRaw,
  parsePactlSinksJson,
  parsePactlSinksText,
  parsePactlDefaultSink,
  parseMacDevices,
};
