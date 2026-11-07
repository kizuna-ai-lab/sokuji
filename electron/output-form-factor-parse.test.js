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
  parsePactlCardsJson,
  parsePactlCardsText,
  parseMacDevices,
  parseWinDevices,
  chromiumRedactedLabel,
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

  // Captured on Ubuntu 22.04 (PipeWire 0.3.48 behind pipewire-pulse, pactl 15.99.1) with the jack's line out
  // active; USB serial numbers scrubbed. That PipeWire puts device.bus on the card only, so the sink's
  // transport comes from its card.
  it('PipeWire 0.3: the analog sink reads builtin from its card, in both forms', () => {
    const expected = [
      { label: 'Built-in Audio Analog Stereo', isDefault: true, formFactor: 'unknown', transport: 'builtin' },
      { label: 'HDA NVidia Digital Stereo (HDMI 2)', isDefault: false, formFactor: 'unknown', transport: 'hdmi' },
      { label: 'Sokuji_Virtual_Speaker', isDefault: false, formFactor: 'unknown', transport: 'virtual' },
    ];
    const pick = ({ label, isDefault, formFactor, transport }) => ({ label, isDefault, formFactor, transport });
    const def = 'alsa_output.pci-0000_00_1f.3.analog-stereo';
    const fromJson = parsePactlSinksJson(fixture('linux-pipewire-0.3-sinks.json'), def, parsePactlCardsJson(fixture('linux-pipewire-0.3-cards.json')));
    expect(fromJson.map(pick)).toEqual(expected);
    expect(fromJson[0].raw.bus).toBe('pci');
    const fromText = parsePactlSinksText(fixture('linux-pipewire-0.3-sinks.txt'), def, parsePactlCardsText(fixture('linux-pipewire-0.3-cards.txt')));
    expect(fromText).toEqual(fromJson);
    // Without the cards the sink says nothing about its bus.
    expect(parsePactlSinksJson(fixture('linux-pipewire-0.3-sinks.json'), def)[0].transport).toBe('unknown');
  });

  it('PipeWire 0.3: the cards list reads every card with its bus, both forms alike', () => {
    const cards = parsePactlCardsJson(fixture('linux-pipewire-0.3-cards.json'));
    expect(cards).toEqual([
      { objectId: '46', alsaCard: '0', bus: 'usb' },
      { objectId: '47', alsaCard: '1', bus: 'usb' },
      { objectId: '48', alsaCard: '2', bus: 'pci' },
      { objectId: '49', alsaCard: '3', bus: 'pci' },
    ]);
    expect(parsePactlCardsText(fixture('linux-pipewire-0.3-cards.txt'))).toEqual(cards);
  });

  // Captured on a Mac mini (Apple Silicon) with a USB headset plugged in; UIDs scrubbed.
  it('macOS: the USB headset the system calls headphones, the built-in speakers, our virtual device', () => {
    const rows = parseMacDevices(fixture('macos-usb-headset.json'));
    expect(rows.map(({ label, isDefault, formFactor, transport }) => ({ label, isDefault, formFactor, transport }))).toEqual([
      { label: 'HyperX Virtual Surround Sound (0951:16a4)', isDefault: false, formFactor: 'headphones', transport: 'usb' },
      { label: 'Mac mini Speakers (Built-in)', isDefault: true, formFactor: 'speakers', transport: 'builtin' },
      { label: 'SokujiVirtualAudio (Virtual)', isDefault: false, formFactor: 'unknown', transport: 'virtual' },
    ]);
  });

  // Captured on the same Mac with Bluetooth earbuds as the default output; UIDs (a Bluetooth one is a MAC address) scrubbed.
  it('macOS: Bluetooth earbuds read headphones from their terminal type', () => {
    const rows = parseMacDevices(fixture('macos-bluetooth.json'));
    expect(rows[0]).toMatchObject({ label: 'Redmi Buds 6 Play (Bluetooth)', isDefault: true, formFactor: 'headphones', transport: 'bluetooth' });
    expect(rows.map((r) => r.raw.uid)).toEqual([undefined, undefined, undefined, undefined]);
  });

  // Captured on a Windows PC (Japanese UI) with two USB headsets, a virtual cable and an HDMI monitor; endpoint ids scrubbed.
  it('Windows: USB headsets carry Chromium\'s label and read headphones; the cable is virtual, the monitor hdmi', () => {
    const rows = parseWinDevices(fixture('windows-usb-headset.json'));
    expect(rows.map(({ label, isDefault, formFactor, transport }) => ({ label, isDefault, formFactor, transport }))).toEqual([
      { label: 'スピーカー (Realtek(R) Audio)', isDefault: true, formFactor: 'speakers', transport: 'builtin' },
      { label: 'ヘッドセット イヤフォン (HyperX Virtual Surround Sound) (0951:16a4)', isDefault: false, formFactor: 'headphones', transport: 'usb' },
      { label: 'CABLE Input (VB-Audio Virtual Cable)', isDefault: false, formFactor: 'unknown', transport: 'virtual' },
      { label: 'CABLE In 16ch (VB-Audio Virtual Cable)', isDefault: false, formFactor: 'unknown', transport: 'virtual' },
      { label: 'ヘッドホン (6- ZUM-2) (1686:05f5)', isDefault: false, formFactor: 'headphones', transport: 'usb' },
      { label: 'WR44-PLUS (NVIDIA High Definition Audio)', isDefault: false, formFactor: 'unknown', transport: 'hdmi' },
      { label: 'WR44-PLUS (NVIDIA High Definition Audio)', isDefault: false, formFactor: 'unknown', transport: 'hdmi' },
    ]);
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
  it('a plain PulseAudio null sink (no factory.name, driver module-null-sink.c) is unknown over virtual', () => {
    const d = one({ ...sink({ props: { 'device.class': 'abstract', 'device.form_factor': 'headphone' } }), driver: 'module-null-sink.c' });
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

// PipeWire before 1.0 (Ubuntu 22.04 ships 0.3.48) leaves device.bus on the card, not the sink.
describe('transport from the card', () => {
  const withCards = (props, cards) => parsePactlSinksJson(JSON.stringify([sink({ props })]), null, cards)[0];
  const usbCard = { objectId: '46', alsaCard: '0', bus: 'usb' };
  const pciCard = { objectId: '48', alsaCard: '2', bus: 'pci' };

  it("a sink without device.bus reads its card's, found by PipeWire object id", () => {
    expect(withCards({ 'device.id': '46', 'api.alsa.pcm.card': '2' }, [pciCard, usbCard]).transport).toBe('usb');
  });
  it('a sink without a PipeWire object id finds its card by ALSA card number', () => {
    expect(withCards({ 'api.alsa.pcm.card': '0' }, [pciCard, usbCard]).transport).toBe('usb');
    expect(withCards({ 'alsa.card': '2' }, [usbCard, pciCard]).transport).toBe('builtin');
  });
  it('a card number match counts for a card that names no object id', () => {
    const noId = { objectId: undefined, alsaCard: '0', bus: 'usb' };
    expect(withCards({ 'device.id': '99', 'api.alsa.pcm.card': '0' }, [noId]).transport).toBe('usb');
  });
  // A card replaced between the two reads can hand its number to another card.
  it('a card number match is refused when that card names another object id', () => {
    expect(withCards({ 'device.id': '99', 'api.alsa.pcm.card': '0' }, [pciCard, usbCard]).transport).toBe('unknown');
  });
  it("the sink's own device.bus wins over its card's", () => {
    expect(withCards({ 'device.bus': 'bluetooth', 'device.id': '48' }, [pciCard]).transport).toBe('bluetooth');
  });
  it('no matching card, or no cards at all, stays unknown', () => {
    expect(withCards({ 'device.id': '7', 'api.alsa.pcm.card': '7' }, [pciCard, usbCard]).transport).toBe('unknown');
    expect(withCards({ 'device.id': '48' }, []).transport).toBe('unknown');
    expect(withCards({ 'device.id': '48' }, undefined).transport).toBe('unknown');
  });
  it('a card is only listed with device.bus: a USB card\'s bus_path starts with "pci-"', () => {
    const json = JSON.stringify([
      { name: 'alsa_card.usb-x', properties: { 'object.id': '46', 'alsa.card': '0', 'device.bus_path': 'pci-0000:00:14.0-usb-0:5:1.0' } },
      { name: 'alsa_card.pci-y', properties: { 'object.id': '48', 'alsa.card': '2', 'device.bus': 'pci' } },
    ]);
    expect(parsePactlCardsJson(json)).toEqual([pciCard]);
  });
  it('cards that are not a JSON array are null', () => {
    expect(parsePactlCardsJson('pactl: invalid option')).toBeNull();
    expect(parsePactlCardsJson('{}')).toBeNull();
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

  it('a plain PulseAudio null sink is unknown over virtual', () => {
    const text = [
      'Sink #3',
      '\tState: SUSPENDED',
      '\tName: sokuji_virtual_output',
      '\tDescription: Sokuji_Virtual_Speaker',
      '\tDriver: module-null-sink.c',
      '\tProperties:',
      '\t\tdevice.description = "Sokuji_Virtual_Speaker"',
      '\t\tdevice.class = "abstract"',
      '\t\tdevice.form_factor = "speaker"',
      '',
    ].join('\n');
    expect(parsePactlSinksText(text, null)[0]).toMatchObject({ formFactor: 'unknown', transport: 'virtual' });
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
      raw: { name: 'External Headphones', transport: 'bltn', dataSource: 'hdpn' },
    });
  });

  it('raw never carries the device UID: a Bluetooth device\'s is its MAC address', () => {
    const raw = parse({ transport: 'blue', uid: '00-00-00-00-00-00:output', terminalType: 'hdph' }).raw;
    expect(raw).not.toHaveProperty('uid');
    expect(JSON.stringify(raw)).not.toContain('00-00-00-00-00-00');
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

  it.each([
    ['hdph', 'headphones'],
    ['rspk', 'headphones'],
    [0x0302, 'headphones'],
    [0x0401, 'headphones'],
    [0x0402, 'headphones'],
    ['spkr', 'speakers'],
    ['lfes', 'speakers'],
    [0x0301, 'speakers'],
    [0x0304, 'speakers'],
    [0x0305, 'speakers'],
    [0x0306, 'speakers'],
    [0x0307, 'speakers'],
    [0x0403, 'speakers'],
    [0x0404, 'speakers'],
    [0x0405, 'speakers'],
    ['spdf', 'unknown'],
    ['line', 'unknown'],
    [0x0303, 'unknown'],
  ])('a bluetooth terminal type %s is %s', (terminalType, formFactor) => {
    expect(parse({ transport: 'blue', terminalType })).toMatchObject({ formFactor, transport: 'bluetooth' });
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

  it('USB reads the terminal type as Bluetooth does: headphones, speakers, else unknown', () => {
    expect(parse({ transport: 'usb ', terminalType: 'hdph' })).toMatchObject({ formFactor: 'headphones', transport: 'usb' });
    expect(parse({ transport: 'usb ', terminalType: 0x0402 })).toMatchObject({ formFactor: 'headphones', transport: 'usb' });
    expect(parse({ transport: 'usb ', terminalType: 'spkr' })).toMatchObject({ formFactor: 'speakers', transport: 'usb' });
    expect(parse({ transport: 'usb ', terminalType: 'line' })).toMatchObject({ formFactor: 'unknown', transport: 'usb' });
    expect(parse({ transport: 'usb ', terminalType: null })).toMatchObject({ formFactor: 'unknown', transport: 'usb' });
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
      raw: { id: '{0.0.0.00000000}.{guid}', name: 'Speakers (Realtek(R) Audio)', formFactor: 1, enumerator: 'HDAUDIO' },
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

  // VB-CABLE's endpoints were measured reporting Speakers (1) and LineLevel (2) under ROOT.
  it.each([
    [1, 'ROOT'],
    [2, 'ROOT'],
    [3, 'ROOT'],
    [1, 'SWD'],
    [5, 'SWD'],
  ])('a virtual endpoint reporting form factor %s under %s is unknown', (formFactor, enumerator) => {
    expect(parse({ formFactor, enumerator })).toMatchObject({ formFactor: 'unknown', transport: 'virtual' });
  });

  it('a form factor reported under an unlisted enumerator still counts', () => {
    expect(parse({ formFactor: 1, enumerator: 'INTELAUDIO' })).toMatchObject({ formFactor: 'speakers', transport: 'unknown' });
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

  // Measured on a real machine: the helper's row for a USB headset, and the label Chromium showed for it.
  it('a USB headset carries the label Chromium shows, its vendor and product ids appended', () => {
    expect(
      parse({
        label: 'ヘッドセット イヤフォン (HyperX Virtual Surround Sound)',
        browserLabel: 'ヘッドセット イヤフォン (HyperX Virtual Surround Sound) (0951:16a4)',
        isDefault: true,
        formFactor: 5,
        enumerator: 'USB',
      }),
    ).toEqual({
      label: 'ヘッドセット イヤフォン (HyperX Virtual Surround Sound) (0951:16a4)',
      isDefault: true,
      formFactor: 'headphones',
      transport: 'usb',
      raw: { id: '{0.0.0.00000000}.{guid}', name: 'ヘッドセット イヤフォン (HyperX Virtual Surround Sound)', formFactor: 5, enumerator: 'USB' },
    });
  });

  it('label is the browser label, else the device name, else empty', () => {
    expect(parse({ label: 'Speakers (Realtek(R) Audio)', browserLabel: 'Speakers (Realtek(R) Audio)' }).label).toBe('Speakers (Realtek(R) Audio)');
    expect(parse({ label: 'Plain' }).label).toBe('Plain');
    expect(parse({ label: 'Plain', browserLabel: '' }).label).toBe('Plain');
    expect(parse({ label: 'Plain', browserLabel: 7 }).label).toBe('Plain');
  });

  it('a non-string label becomes empty', () => {
    expect(parse({ label: 42 }).label).toBe('');
  });

  it('text that is not a JSON array gives null', () => {
    expect(parseWinDevices('not json')).toBeNull();
    expect(parseWinDevices('{"a":1}')).toBeNull();
  });
});

// Chromium 152 rewrites every output whose name holds "AirPods" before a page sees it
// (media/audio/audio_device_description.cc, RedactDeviceName), so the native label must be
// rewritten the same way to match.
describe('chromiumRedactedLabel', () => {
  it.each([
    // macOS: device name plus Chromium's transport suffix.
    ["Henrik's AirPods Pro (Bluetooth)", 'AirPods (Bluetooth)'],
    // Windows, English: the form-factor prefix and the profile survive.
    ["Headphones (Henrik's AirPods Pro Stereo) (Bluetooth)", 'Headphones (AirPods Stereo) (Bluetooth)'],
    ["Headset (Henrik's AirPods Hands-Free AG Audio) (Bluetooth)", 'Headset (AirPods Hands-Free AG Audio) (Bluetooth)'],
    ["Headset (Henrik's AirPods Hands-Free) (Bluetooth)", 'Headset (AirPods Hands-Free) (Bluetooth)'],
    // A rule word in the owner's name counts too, in Chromium's order: Headphones before Headset, Hands-Free before Stereo.
    ["Headset (Headphones User's AirPods) (Bluetooth)", 'Headphones (AirPods) (Bluetooth)'],
    ["Headset (Stereo Sam's AirPods Hands-Free) (Bluetooth)", 'Headset (AirPods Hands-Free) (Bluetooth)'],
    // Windows, Japanese: Chromium knows only the English prefixes, so the prefix is dropped.
    ["ヘッドホン (Henrik's AirPods) (Bluetooth)", 'AirPods (Bluetooth)'],
    // Linux: the sink description alone.
    ["Henrik's AirPods", 'AirPods'],
  ])('%s reads %s', (native, chromium) => {
    expect(chromiumRedactedLabel(native)).toBe(chromium);
  });

  it('leaves every other name as it is', () => {
    for (const name of ['Speakers (Realtek(R) Audio)', 'MacBook Pro Speakers (Built-in)', 'Headphones (WH-1000XM4 Stereo) (Bluetooth)', 'airpods', '']) {
      expect(chromiumRedactedLabel(name)).toBe(name);
    }
  });

  it("each platform's rows carry the rewritten label; raw keeps the system's name", () => {
    const mac = parseMacDevices(JSON.stringify([{ label: "Henrik's AirPods Pro", browserLabel: "Henrik's AirPods Pro (Bluetooth)", transport: 'blue', isDefault: false }]))[0];
    expect(mac.label).toBe('AirPods (Bluetooth)');
    expect(mac.raw.name).toBe("Henrik's AirPods Pro");
    const win = parseWinDevices(JSON.stringify([{ id: '{0.0.0.00000000}.{guid}', label: "Headphones (Henrik's AirPods Pro Stereo)", browserLabel: "Headphones (Henrik's AirPods Pro Stereo) (Bluetooth)", isDefault: false, formFactor: 3, enumerator: 'BTHENUM' }]))[0];
    expect(win).toMatchObject({ label: 'Headphones (AirPods Stereo) (Bluetooth)', formFactor: 'headphones', transport: 'bluetooth' });
    expect(win.raw.name).toBe("Headphones (Henrik's AirPods Pro Stereo)");
    const linux = parsePactlSinksJson(JSON.stringify([{ ...sink({ name: 'bluez_output.x', props: { 'device.bus': 'bluetooth' } }), description: "Henrik's AirPods" }]), null)[0];
    expect(linux.label).toBe('AirPods');
  });
});
