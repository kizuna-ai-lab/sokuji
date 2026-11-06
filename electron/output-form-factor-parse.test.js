// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  capRaw,
  parsePactlSinksJson,
  parsePactlSinksText,
  parsePactlDefaultSink,
  parseMacDevices,
  parseWinDevices,
} = require('./output-form-factor-parse.js');

const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, '__fixtures__', 'output-devices', name), 'utf8');

const sink = ({ name = 'sink0', props = {}, port, portType } = {}) => ({
  name,
  description: 'Test Sink',
  properties: props,
  active_port: port,
  ports: port ? [{ name: port, type: portType }] : [],
});
const one = (s, def = null) => parsePactlSinksJson(JSON.stringify([s]), def)[0];

describe('captured fixtures', () => {
  it('the captured HDMI sink is unknown over hdmi', () => {
    const fromJson = parsePactlSinksJson(fixture('linux-hdmi.json'), null);
    expect(fromJson).toHaveLength(1);
    expect(fromJson[0]).toMatchObject({
      label: 'Built-in Audio Digital Stereo (HDMI)',
      formFactor: 'unknown',
      transport: 'hdmi',
    });
    const fromText = parsePactlSinksText(fixture('linux-hdmi.txt'), null);
    expect(fromText).toEqual(fromJson);
  });
});

describe('rule order', () => {
  it('a typed Headphones port beats device.form_factor speaker', () => {
    const d = one(sink({ port: 'x', portType: 'Headphones', props: { 'device.form_factor': 'speaker' } }));
    expect(d.formFactor).toBe('headphones');
  });
  it('a Headset port is headphones and a Speaker port is speakers', () => {
    expect(one(sink({ port: 'x', portType: 'Headset' })).formFactor).toBe('headphones');
    expect(one(sink({ port: 'x', portType: 'Speaker' })).formFactor).toBe('speakers');
  });
  it('an untyped analog-output-speaker is speakers', () => {
    expect(one(sink({ port: 'analog-output-speaker' })).formFactor).toBe('speakers');
  });
  it('an untyped analog-output-headphones is headphones', () => {
    expect(one(sink({ port: 'analog-output-headphones' })).formFactor).toBe('headphones');
  });
  it('an untyped other port with form_factor headset is headphones', () => {
    const d = one(sink({ port: 'other', props: { 'device.form_factor': 'headset' } }));
    expect(d.formFactor).toBe('headphones');
  });
  it('a typed Line port with form_factor speaker is speakers', () => {
    const d = one(sink({ port: 'line', portType: 'Line', props: { 'device.form_factor': 'speaker' } }));
    expect(d.formFactor).toBe('speakers');
  });
  it('an HDMI port with form_factor speaker is unknown', () => {
    const d = one(sink({ port: 'hdmi-output-0', portType: 'HDMI', props: { 'device.form_factor': 'speaker' } }));
    expect(d.formFactor).toBe('unknown');
    expect(d.transport).toBe('hdmi');
  });
  it('an HDMI port recognised by name only is hdmi', () => {
    expect(one(sink({ port: 'hdmi-output-1' })).transport).toBe('hdmi');
  });
  it('a null sink is unknown over virtual', () => {
    const d = one(sink({ props: { 'factory.name': 'support.null-audio-sink', 'device.form_factor': 'speaker' } }));
    expect(d).toMatchObject({ formFactor: 'unknown', transport: 'virtual' });
  });
  it('form_factor internal alone is unknown', () => {
    expect(one(sink({ props: { 'device.form_factor': 'internal' } })).formFactor).toBe('unknown');
  });
});

describe('transport from the bus', () => {
  it.each([
    ['pci', 'builtin'],
    ['usb', 'usb'],
    ['bluetooth', 'bluetooth'],
    [undefined, 'unknown'],
  ])('bus %s is %s', (bus, transport) => {
    const props = bus ? { 'device.bus': bus } : {};
    expect(one(sink({ props })).transport).toBe(transport);
  });
});

describe('default sink', () => {
  it('isDefault follows the default sink name', () => {
    const list = parsePactlSinksJson(JSON.stringify([sink({ name: 'a' }), sink({ name: 'b' })]), 'b');
    expect(list.map((d) => d.isDefault)).toEqual([false, true]);
  });
  it('parsePactlDefaultSink reads both forms', () => {
    expect(parsePactlDefaultSink('{"default_sink_name":"abc","x":1}', true)).toBe('abc');
    expect(parsePactlDefaultSink('Server Name: PipeWire\nDefault Sink: abc\nDefault Source: z\n', false)).toBe('abc');
    expect(parsePactlDefaultSink('nonsense', true)).toBeNull();
    expect(parsePactlDefaultSink('Server Name: x\n', false)).toBeNull();
  });
});

describe('bad input', () => {
  it('not JSON is null', () => {
    expect(parsePactlSinksJson('pactl: invalid option', null)).toBeNull();
    expect(parsePactlSinksJson('{}', null)).toBeNull();
  });
});

describe('text parser', () => {
  it('reads ports without a type', () => {
    const text = [
      'Sink #1',
      '\tState: RUNNING',
      '\tName: alsa_output.pci-0000_00_1f.3.analog-stereo',
      '\tDescription: Built-in Audio Analog Stereo',
      '\tProperties:',
      '\t\tdevice.bus = "pci"',
      '\t\tdevice.form_factor = "internal"',
      '\tPorts:',
      '\t\tanalog-output-speaker: Speakers (priority: 10000)',
      '\t\tanalog-output-headphones: Headphones (priority: 9000, not available)',
      '\tActive Port: analog-output-headphones',
      '',
      'Sink #2',
      '\tName: other',
      '\tDescription: Other',
      '\tPorts:',
      '\t\tx: X (type: Speaker, priority: 1)',
      '\tActive Port: x',
      '',
    ].join('\n');
    const list = parsePactlSinksText(text, 'other');
    expect(list[0]).toMatchObject({ formFactor: 'headphones', transport: 'builtin', isDefault: false });
    expect(list[0].raw.portType).toBeUndefined();
    expect(list[1]).toMatchObject({ formFactor: 'speakers', isDefault: true });
  });
});

describe('capRaw', () => {
  it('raw is capped', () => {
    const input = { nested: { a: 1 }, long: 'x'.repeat(500) };
    for (let i = 0; i < 20; i++) input[`k${i}`] = i;
    const out = capRaw(input);
    expect(Object.keys(out)).toHaveLength(12);
    expect(out.long).toHaveLength(120);
    expect(out.nested).toBeUndefined();
  });
});

describe('parseMacDevices', () => {
  const row = (over = {}) => ({
    id: 42,
    uid: 'uid-1',
    label: 'Test Device',
    isDefault: false,
    transport: 'bltn',
    dataSource: null,
    terminalType: null,
    ...over,
  });
  const parse = (over) => parseMacDevices(JSON.stringify([row(over)]))[0];

  it('built-in headphone jack is headphones over builtin', () => {
    expect(parse({ label: 'External Headphones', isDefault: true, dataSource: 'hdpn' })).toEqual({
      label: 'External Headphones',
      isDefault: true,
      formFactor: 'headphones',
      transport: 'builtin',
      raw: { name: 'External Headphones', uid: 'uid-1', transport: 'bltn', dataSource: 'hdpn' },
    });
  });

  it('built-in speakers are speakers', () => {
    expect(parse({ label: 'MacBook Pro Speakers', dataSource: 'ispk' })).toMatchObject({
      formFactor: 'speakers',
      transport: 'builtin',
    });
  });

  it('built-in with no data source is unknown', () => {
    expect(parse({ dataSource: null })).toMatchObject({ formFactor: 'unknown', transport: 'builtin' });
  });

  it('bluetooth reads the terminal type', () => {
    expect(parse({ transport: 'blue', terminalType: 'hdph' })).toMatchObject({
      formFactor: 'headphones',
      transport: 'bluetooth',
    });
    expect(parse({ transport: 'blea', terminalType: 0x0302 })).toMatchObject({ formFactor: 'headphones' });
    expect(parse({ transport: 'blue', terminalType: 0x0402 })).toMatchObject({ formFactor: 'headphones' });
    expect(parse({ transport: 'blue', terminalType: 'spkr' })).toMatchObject({ formFactor: 'speakers' });
    expect(parse({ transport: 'blue', terminalType: 0x0301 })).toMatchObject({ formFactor: 'speakers' });
    expect(parse({ transport: 'blue', terminalType: 0 })).toMatchObject({
      formFactor: 'unknown',
      transport: 'bluetooth',
    });
  });

  it('hdmi and displayport are unknown over hdmi', () => {
    expect(parse({ transport: 'hdmi' })).toMatchObject({ formFactor: 'unknown', transport: 'hdmi' });
    expect(parse({ transport: 'dprt' })).toMatchObject({ transport: 'hdmi' });
  });

  it('usb (with its trailing space) is unknown over usb', () => {
    expect(parse({ transport: 'usb ' })).toMatchObject({ formFactor: 'unknown', transport: 'usb' });
  });

  it('grup and virt are virtual; airp is unknown over unknown', () => {
    expect(parse({ transport: 'grup' })).toMatchObject({ transport: 'virtual', formFactor: 'unknown' });
    expect(parse({ transport: 'virt' })).toMatchObject({ transport: 'virtual' });
    expect(parse({ transport: 'airp' })).toMatchObject({ transport: 'unknown', formFactor: 'unknown' });
  });

  it('a form factor needs the matching transport', () => {
    expect(parse({ transport: 'usb ', dataSource: 'hdpn' })).toMatchObject({ formFactor: 'unknown' });
    expect(parse({ transport: 'bltn', terminalType: 'hdph' })).toMatchObject({ formFactor: 'unknown' });
  });

  it('label is the browser label, else the device name, else empty', () => {
    const withBrowser = parse({ label: 'MacBook Pro Speakers', browserLabel: 'MacBook Pro Speakers (Built-in)', dataSource: 'ispk' });
    expect(withBrowser.label).toBe('MacBook Pro Speakers (Built-in)');
    expect(withBrowser.raw.name).toBe('MacBook Pro Speakers');
    expect(parse({ label: 'Plain' }).label).toBe('Plain');
    expect(parse({ label: 'Plain', browserLabel: '' }).label).toBe('Plain');
    expect(parse({ label: 42 }).label).toBe('');
  });

  it('text that is not a JSON array gives null', () => {
    expect(parseMacDevices('not json')).toBeNull();
    expect(parseMacDevices('{"a":1}')).toBeNull();
  });
});

describe('parseWinDevices', () => {
  const row = (over = {}) => ({
    id: '{0.0.0.00000000}.{guid}',
    label: 'Test Device',
    isDefault: false,
    formFactor: null,
    enumerator: null,
    ...over,
  });
  const parse = (over) => parseWinDevices(JSON.stringify([row(over)]))[0];

  it('Speakers on HDAUDIO are speakers over builtin', () => {
    expect(parse({ label: 'Speakers (Realtek(R) Audio)', isDefault: true, formFactor: 1, enumerator: 'HDAUDIO' })).toEqual({
      label: 'Speakers (Realtek(R) Audio)',
      isDefault: true,
      formFactor: 'speakers',
      transport: 'builtin',
      raw: { id: '{0.0.0.00000000}.{guid}', formFactor: 1, enumerator: 'HDAUDIO' },
    });
  });

  it('Headphones on HDAUDIO are headphones', () => {
    expect(parse({ label: 'Headphones (Realtek(R) Audio)', formFactor: 3, enumerator: 'HDAUDIO' })).toMatchObject({
      formFactor: 'headphones',
      transport: 'builtin',
    });
  });

  it('a Bluetooth headset is headphones over bluetooth', () => {
    expect(parse({ formFactor: 5, enumerator: 'BTHHFENUM' })).toMatchObject({
      formFactor: 'headphones',
      transport: 'bluetooth',
    });
    expect(parse({ formFactor: 6, enumerator: 'BTHENUM' })).toMatchObject({
      formFactor: 'headphones',
      transport: 'bluetooth',
    });
  });

  it('a monitor (digital display) is unknown over hdmi', () => {
    expect(parse({ formFactor: 9, enumerator: 'HDAUDIO' })).toMatchObject({ formFactor: 'unknown', transport: 'hdmi' });
  });

  it('a virtual cable is unknown over virtual', () => {
    expect(parse({ label: 'CABLE Input (VB-Audio Virtual Cable)', formFactor: 10, enumerator: 'ROOT' })).toMatchObject({
      formFactor: 'unknown',
      transport: 'virtual',
    });
    expect(parse({ formFactor: 1, enumerator: 'SWD' })).toMatchObject({ transport: 'virtual' });
  });

  it('a USB DAC is unknown over usb', () => {
    expect(parse({ formFactor: 2, enumerator: 'USB' })).toMatchObject({ formFactor: 'unknown', transport: 'usb' });
  });

  it('the enumerator compares case-insensitively; an unlisted one is unknown', () => {
    expect(parse({ formFactor: 1, enumerator: 'usb' })).toMatchObject({ transport: 'usb' });
    expect(parse({ formFactor: 1, enumerator: 'PCI' })).toMatchObject({ transport: 'unknown' });
  });

  it('a null form factor and enumerator are unknown', () => {
    expect(parse({})).toMatchObject({ formFactor: 'unknown', transport: 'unknown', raw: { id: '{0.0.0.00000000}.{guid}' } });
  });

  it('a non-string label becomes empty', () => {
    expect(parse({ label: 42 }).label).toBe('');
  });

  it('text that is not a JSON array gives null', () => {
    expect(parseWinDevices('not json')).toBeNull();
    expect(parseWinDevices('{"a":1}')).toBeNull();
  });
});
