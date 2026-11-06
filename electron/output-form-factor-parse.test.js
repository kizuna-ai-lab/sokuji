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
