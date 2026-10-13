import { describe, expect, it } from 'vitest';
import { CAPABILITIES, inputSchema } from '../src/capabilities';
import { describe as describeCoil, docsPage, llmsText } from '../src/docs';
import { runModule } from '../src/run-module';

const names = CAPABILITIES.map((capability) => capability.name);

describe('one capability list', () => {
  it('has unique names', () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it('lists every required field in the input schema', () => {
    for (const capability of CAPABILITIES)
      for (const field of capability.required)
        expect(inputSchema(capability).properties).toHaveProperty(field);
  });

  it('documents every capability in llms.txt, /docs and coil_describe', () => {
    const llms = llmsText('https://coil.example');
    const html = docsPage('https://coil.example');
    const declaration = describeCoil();

    for (const name of names) {
      expect(llms).toContain(`### ${name}`);
      expect(html).toContain(`id="${name}"`);
      expect(declaration).toContain(`${name}(input:`);
    }
  });

  it('gives coil_run scripts exactly the documented capabilities', () => {
    const module = runModule('return 1;');

    for (const name of names)
      expect(module).toContain(`${name}: (input) => call(${JSON.stringify(name)}, input)`);
  });

  it('escapes the docs page', () => {
    expect(docsPage('https://x.example/"><script>')).not.toContain('"><script>');
  });

  it('can drive the full agent path: create, shell, browser and pause', () => {
    for (const name of [
      'thread_create',
      'thread_exec',
      'browser_open',
      'browser_click',
      'thread_pause',
    ])
      expect(names).toContain(name);
  });
});
