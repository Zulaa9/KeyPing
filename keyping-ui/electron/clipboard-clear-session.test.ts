import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ClipboardClearSessionManager,
  ClipboardTimerHandle
} from './clipboard-clear-session';

type Task = { id: number; fn: () => void; canceled: boolean; ttlMs: number };

function createFakeTimers() {
  const tasks = new Map<number, Task>();
  let nextId = 1;

  return {
    schedule(fn: () => void, ttlMs: number): ClipboardTimerHandle {
      const id = nextId++;
      tasks.set(id, { id, fn, canceled: false, ttlMs });
      return id as unknown as ClipboardTimerHandle;
    },
    cancel(handle: ClipboardTimerHandle): void {
      const id = handle as unknown as number;
      const task = tasks.get(id);
      if (task) task.canceled = true;
    },
    run(id: number): void {
      const task = tasks.get(id);
      if (!task || task.canceled) return;
      task.fn();
    },
    latestId(): number {
      return nextId - 1;
    }
  };
}

test('clears clipboard when current content still matches copied secret', async () => {
  const timers = createFakeTimers();
  let clipboardValue = 'secret-A';
  let clearCount = 0;
  let historyClearCount = 0;

  const manager = new ClipboardClearSessionManager({
    readClipboardText: () => clipboardValue,
    clearClipboard: () => {
      clearCount++;
      clipboardValue = '';
    },
    clearWindowsClipboardHistory: async () => {
      historyClearCount++;
      return true;
    },
    schedule: timers.schedule,
    cancel: timers.cancel
  });

  manager.startSession('secret-A', 20_000);
  timers.run(timers.latestId());
  await Promise.resolve();

  assert.equal(clearCount, 1);
  assert.equal(historyClearCount, 1);
  assert.equal(clipboardValue, '');
  assert.equal(manager.getActiveSession(), null);
});

test('does not clear clipboard when user copied other content later', async () => {
  const timers = createFakeTimers();
  let clipboardValue = 'secret-A';
  let clearCount = 0;
  let historyClearCount = 0;

  const manager = new ClipboardClearSessionManager({
    readClipboardText: () => clipboardValue,
    clearClipboard: () => {
      clearCount++;
      clipboardValue = '';
    },
    clearWindowsClipboardHistory: async () => {
      historyClearCount++;
      return true;
    },
    schedule: timers.schedule,
    cancel: timers.cancel
  });

  manager.startSession('secret-A', 20_000);
  clipboardValue = 'user-text';
  timers.run(timers.latestId());
  await Promise.resolve();

  assert.equal(clearCount, 0);
  assert.equal(historyClearCount, 0);
  assert.equal(clipboardValue, 'user-text');
  assert.equal(manager.getActiveSession(), null);
});

test('invalidates previous operation when a new KeyPing copy starts', async () => {
  const timers = createFakeTimers();
  let clipboardValue = 'secret-A';
  let clearCount = 0;
  let historyClearCount = 0;

  const manager = new ClipboardClearSessionManager({
    readClipboardText: () => clipboardValue,
    clearClipboard: () => {
      clearCount++;
      clipboardValue = '';
    },
    clearWindowsClipboardHistory: async () => {
      historyClearCount++;
      return true;
    },
    schedule: timers.schedule,
    cancel: timers.cancel
  });

  manager.startSession('secret-A', 20_000);
  const firstTimerId = timers.latestId();

  clipboardValue = 'secret-B';
  manager.startSession('secret-B', 20_000);
  const secondTimerId = timers.latestId();

  timers.run(firstTimerId);
  await Promise.resolve();

  assert.equal(clearCount, 0);
  assert.equal(historyClearCount, 0);
  assert.equal(clipboardValue, 'secret-B');

  timers.run(secondTimerId);
  await Promise.resolve();

  assert.equal(clearCount, 1);
  assert.equal(historyClearCount, 1);
  assert.equal(clipboardValue, '');
  assert.equal(manager.getActiveSession(), null);
});

test('handles missing active operation safely and cancels timers on dispose', async () => {
  const timers = createFakeTimers();
  let clipboardValue = 'secret-A';
  let clearCount = 0;

  const manager = new ClipboardClearSessionManager({
    readClipboardText: () => clipboardValue,
    clearClipboard: () => {
      clearCount++;
      clipboardValue = '';
    },
    schedule: timers.schedule,
    cancel: timers.cancel
  });

  manager.invalidateActive();
  manager.startSession('secret-A', 20_000);
  const timerId = timers.latestId();
  manager.dispose();

  timers.run(timerId);
  await Promise.resolve();

  assert.equal(clearCount, 0);
  assert.equal(clipboardValue, 'secret-A');
  assert.equal(manager.getActiveSession(), null);
});
