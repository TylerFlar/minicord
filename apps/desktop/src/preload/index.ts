import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type IpcChannel, type NativeBridge } from "../../../../packages/core/src/ipc.ts";

const allowed = new Set<string>(IPC_CHANNELS);

/** Only whitelisted channels; all logic lives in the UI's Electron adapter and the main process. */
const bridge: NativeBridge = {
  invoke(channel: IpcChannel, ...args: unknown[]) {
    if (!allowed.has(channel)) return Promise.reject(new Error(`blocked channel ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  send(channel: IpcChannel, ...args: unknown[]) {
    if (allowed.has(channel)) ipcRenderer.send(channel, ...args);
  },
  on(channel: IpcChannel, fn: (...args: unknown[]) => void) {
    if (!allowed.has(channel)) return () => {};
    const listener = (_e: unknown, ...args: unknown[]) => fn(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld("minicordNative", bridge);
