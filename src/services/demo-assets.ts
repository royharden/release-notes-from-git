import trapsText from '../../fixtures/gitlog/synthetic-traps.gitlog.v1.json?raw';
import smallText from '../../fixtures/gitlog/synthetic-small.gitlog.v1.json?raw';
import untypedText from '../../fixtures/gitlog/synthetic-untyped.gitlog.v1.json?raw';
import indexJson from '../../fixtures/recorded/INDEX.json';
import firstRecording from '../../fixtures/recorded/dd2c1e4946386d71a875ca23afc50e1fb6fcc7c42d11c26a9fc1222f6b7d63c6.json';
import secondRecording from '../../fixtures/recorded/5b6ef73b563b09a47c6fc60350d23e5dc4a887e4701f9c174519c77cf0e750df.json';
import type { RecordingFile, RecordingIndex } from '@shared/providers/mock.ts';

export const DEMO_FIXTURES = {
  'synthetic-traps': { label: 'Synthetic traps', text: trapsText, recorded: true },
  'synthetic-small': { label: 'Small release', text: smallText, recorded: false },
  'synthetic-untyped': { label: 'Untyped commits', text: untypedText, recorded: false },
} as const;
export type DemoFixture = keyof typeof DEMO_FIXTURES;
export const recordingIndex = indexJson as RecordingIndex;
export const recordingFiles: Readonly<Record<string, RecordingFile>> = {
  'dd2c1e4946386d71a875ca23afc50e1fb6fcc7c42d11c26a9fc1222f6b7d63c6.json': firstRecording as RecordingFile,
  '5b6ef73b563b09a47c6fc60350d23e5dc4a887e4701f9c174519c77cf0e750df.json': secondRecording as RecordingFile,
};
