import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { pool } from "../db.js";

after(async () => {
  await pool.end();
});

type Message = Record<string, any>;

type Waiter = {
  predicate: (message: Message) => boolean;
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type SocketState = { queue: Message[]; waiters: Waiter[] };

const socketStates = new WeakMap<WebSocket, SocketState>();

function stateFor(socket: WebSocket): SocketState {
  const existing = socketStates.get(socket);
  if (existing) return existing;
  const state: SocketState = { queue: [], waiters: [] };
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as Message;
    const index = state.waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) {
      const [waiter] = state.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      return;
    }
    state.queue.push(message);
  });
  socket.on("error", (error) => {
    for (const waiter of state.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  });
  socketStates.set(socket, state);
  return state;
}

function waitForMessage(socket: WebSocket, predicate: (message: Message) => boolean, timeoutMs = 5_000): Promise<Message> {
  const state = stateFor(socket);
  const queuedIndex = state.queue.findIndex(predicate);
  if (queuedIndex >= 0) {
    const [message] = state.queue.splice(queuedIndex, 1);
    return Promise.resolve(message);
  }
  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      predicate,
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = state.waiters.indexOf(waiter);
        if (index >= 0) state.waiters.splice(index, 1);
        reject(new Error("timed out waiting for WebSocket message"));
      }, timeoutMs)
    };
    state.waiters.push(waiter);
  });
}

